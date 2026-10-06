import { spawn, execFile, type ChildProcess, type SpawnOptions } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { promisify } from 'node:util';
import { cacheRoot } from '../env/platform.js';
import { logDebug, logInfo } from '../util/log.js';

const pexecFile = promisify(execFile);

export interface RunResult {
  code: number | null;
  signal: NodeJS.Signals | null;
  output: string;
  timedOut: boolean;
  durationMs: number;
}

/** Run a command to completion, capturing stdout+stderr interleaved. */
export function runCommand(
  command: string,
  args: string[],
  options: SpawnOptions & { timeoutMs?: number; signal?: AbortSignal; onLine?: (line: string) => void } = {},
): Promise<RunResult> {
  const started = Date.now();
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { ...options, stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true });
    let output = '';
    let pending = '';
    let timedOut = false;
    const onData = (d: Buffer) => {
      const s = d.toString('utf8');
      output += s;
      if (options.onLine) {
        pending += s;
        const lines = pending.split(/\r?\n/);
        pending = lines.pop() ?? '';
        for (const l of lines) options.onLine(l);
      }
    };
    child.stdout?.on('data', onData);
    child.stderr?.on('data', onData);
    const timer = options.timeoutMs
      ? setTimeout(() => {
          timedOut = true;
          void killTree(child.pid);
        }, options.timeoutMs)
      : undefined;
    const onAbort = () => void killTree(child.pid);
    options.signal?.addEventListener('abort', onAbort, { once: true });
    child.on('error', (err) => {
      if (timer) clearTimeout(timer);
      reject(err);
    });
    child.on('close', (code, signal) => {
      if (timer) clearTimeout(timer);
      options.signal?.removeEventListener('abort', onAbort);
      if (pending && options.onLine) options.onLine(pending);
      resolve({ code, signal, output, timedOut, durationMs: Date.now() - started });
    });
  });
}

/** Kill a process and its children (Windows: taskkill /T). */
export async function killTree(pid: number | undefined): Promise<void> {
  if (!pid) return;
  try {
    if (process.platform === 'win32') {
      await pexecFile('taskkill', ['/PID', String(pid), '/T', '/F'], { windowsHide: true });
    } else {
      try {
        process.kill(-pid, 'SIGKILL');
      } catch {
        process.kill(pid, 'SIGKILL');
      }
    }
  } catch {
    // already gone
  }
}

export function isAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (err) {
    return (err as NodeJS.ErrnoException).code === 'EPERM';
  }
}

// ---------------------------------------------------------------------------------------------
// PID registry: engines we start are recorded so a crashed/killed server can clean them up later.

interface RegistryEntry {
  pid: number;
  exe: string;
  project: string;
  startedAt: number;
  owner: number; // MCP server pid
}

function registryFile(): string {
  return path.join(cacheRoot(), 'runtime', 'engines.json');
}

function readRegistry(): RegistryEntry[] {
  try {
    return JSON.parse(fs.readFileSync(registryFile(), 'utf8')) as RegistryEntry[];
  } catch {
    return [];
  }
}

function writeRegistry(entries: RegistryEntry[]): void {
  try {
    fs.mkdirSync(path.dirname(registryFile()), { recursive: true });
    fs.writeFileSync(registryFile(), JSON.stringify(entries, null, 2));
  } catch (err) {
    logDebug('could not write engine registry', err);
  }
}

export function registerEngine(child: ChildProcess, exe: string, project: string): void {
  if (!child.pid) return;
  const entries = readRegistry().filter((e) => e.pid !== child.pid);
  entries.push({ pid: child.pid, exe, project, startedAt: Date.now(), owner: process.pid });
  writeRegistry(entries);
}

export function unregisterEngine(pid: number | undefined): void {
  if (!pid) return;
  writeRegistry(readRegistry().filter((e) => e.pid !== pid));
}

/**
 * Kill engines recorded by MCP servers that are no longer running (e.g. the session crashed).
 * Only processes whose image name still matches the recorded executable are killed.
 */
export async function cleanupOrphanEngines(): Promise<number> {
  const entries = readRegistry();
  if (!entries.length) return 0;
  const keep: RegistryEntry[] = [];
  let killed = 0;
  for (const e of entries) {
    if (isAlive(e.owner) && e.owner !== process.pid) {
      keep.push(e);
      continue;
    }
    if (isAlive(e.pid) && (await processMatches(e.pid, e.exe))) {
      logInfo(`killing orphaned engine pid ${e.pid} (${e.project})`);
      await killTree(e.pid);
      killed++;
    }
  }
  writeRegistry(keep);
  return killed;
}

async function processMatches(pid: number, exe: string): Promise<boolean> {
  const image = path.basename(exe).toLowerCase();
  try {
    if (process.platform === 'win32') {
      const { stdout } = await pexecFile('tasklist', ['/FI', `PID eq ${pid}`, '/FO', 'CSV', '/NH'], { windowsHide: true });
      return stdout.toLowerCase().includes(`"${image}"`);
    }
    const { stdout } = await pexecFile('ps', ['-p', String(pid), '-o', 'comm=']);
    return stdout.toLowerCase().includes(image.replace(/\.exe$/, ''));
  } catch {
    return false;
  }
}

/** Find the process listening on a local TCP port (used to locate an editor-launched engine). */
export async function pidForListeningPort(port: number): Promise<number | undefined> {
  try {
    if (process.platform === 'win32') {
      const { stdout } = await pexecFile('netstat', ['-ano', '-p', 'TCP'], { windowsHide: true, maxBuffer: 16 * 1024 * 1024 });
      for (const line of stdout.split(/\r?\n/)) {
        const parts = line.trim().split(/\s+/);
        if (parts.length >= 5 && parts[3] === 'LISTENING' && parts[1]!.endsWith(`:${port}`)) return Number(parts[4]);
      }
      return undefined;
    }
    const { stdout } = await pexecFile('lsof', ['-nP', `-iTCP:${port}`, '-sTCP:LISTEN', '-t']);
    const pid = Number(stdout.trim().split(/\s+/)[0]);
    return Number.isFinite(pid) && pid > 0 ? pid : undefined;
  } catch {
    return undefined;
  }
}

/** Simple async mutex keyed by string (one build/run operation per project at a time). */
const locks = new Map<string, Promise<void>>();
export async function withLock<T>(key: string, fn: () => Promise<T>): Promise<T> {
  const prev = locks.get(key) ?? Promise.resolve();
  let release!: () => void;
  const current = new Promise<void>((r) => (release = r));
  const chained = prev.then(() => current);
  locks.set(key, chained);
  await prev;
  try {
    return await fn();
  } finally {
    release();
    if (locks.get(key) === chained) locks.delete(key);
  }
}
