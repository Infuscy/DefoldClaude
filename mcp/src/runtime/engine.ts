import { spawn, type ChildProcess } from 'node:child_process';
import crypto from 'node:crypto';
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import type net from 'node:net';
import path from 'node:path';
import type { DefoldInstall } from '../env/locate.js';
import type { DefoldProject } from '../env/project.js';
import { logDebug } from '../util/log.js';
import { AGENT_BUILD_DIR, resolveEngineBinary } from './enginebin.js';
import { editorConsole, type EditorConnection } from './editor.js';
import { onShutdown } from './lifecycle.js';
import { connectLogService, engineInfo, type EngineInfo } from './logservice.js';
import { LogBuffer } from './logs.js';
import { killTree, registerEngine, unregisterEngine } from './processes.js';
import { encodeExit, encodeReloadBatches, encodeResize } from './protobuf.js';
import { addRuntimeSummaryProvider } from './state.js';

export interface EngineSession {
  projectRoot: string;
  /** bob = launched here headless, editor = launched by the Defold editor, attached = started elsewhere (device, bundle). */
  backend: 'bob' | 'editor' | 'attached';
  child?: ChildProcess;
  pid?: number;
  exe?: string;
  serviceUrl?: string;
  logs: LogBuffer;
  startedAt: number;
  exited?: { code: number | null; signal: string | null };
  editor?: EditorConnection;
  /** TCP log stream of an attached engine. */
  logSocket?: net.Socket;
  /** Number of editor console lines already copied into `logs`. */
  consoleSeen: number;
  /** Last console line copied; if it changes position the editor cleared/replaced the console (it does on each run). */
  consoleTail?: string;
  /** Content hashes of build/agent outputs, used to find what changed for hot reload. */
  manifest?: Map<string, FileStamp>;
}

interface FileStamp {
  size: number;
  mtimeMs: number;
  hash: string;
}

const sessions = new Map<string, EngineSession>();

export function getSession(projectRoot: string): EngineSession | undefined {
  return sessions.get(projectRoot);
}

export function isRunning(s: EngineSession | undefined): s is EngineSession {
  return !!s && !s.exited;
}

/** Make `session` the project's current one, closing the log stream of the one it replaces. */
function setSession(session: EngineSession): void {
  const old = sessions.get(session.projectRoot);
  if (old && old !== session) closeLogStream(old);
  sessions.set(session.projectRoot, session);
}

/** Close an attached engine's log stream on purpose (its close handler then stays quiet). */
function closeLogStream(session: EngineSession): void {
  const socket = session.logSocket;
  session.logSocket = undefined;
  socket?.destroy();
}

addRuntimeSummaryProvider(() => {
  const running = [...sessions.values()].filter((s) => !s.exited);
  if (!running.length) return undefined;
  return {
    text:
      'Running games:\n' +
      running.map((s) => `  ${s.projectRoot} via ${s.backend}${s.serviceUrl ? ` (engine service ${s.serviceUrl})` : ''}${s.pid ? ` pid ${s.pid}` : ''}`).join('\n'),
  };
});

onShutdown(async () => {
  for (const s of sessions.values()) if (s.backend === 'bob' && !s.exited) await stopSession(s);
});

/** Launch dmengine on the headless build output (build/agent). The caller builds first. */
export async function startHeadless(install: DefoldInstall, project: DefoldProject): Promise<EngineSession> {
  const existing = sessions.get(project.root);
  if (existing && !existing.exited) await stopSession(existing);

  const exe = await resolveEngineBinary(install, project.root);
  const args = [`--config=resource.uri=${AGENT_BUILD_DIR}`, '--config=display.focus_on_show=0', `${AGENT_BUILD_DIR}/game.projectc`];
  const child = spawn(exe, args, {
    cwd: project.root,
    env: { ...process.env, DM_SERVICE_PORT: 'dynamic', DM_QUIT_ON_ESC: '0' },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  const session: EngineSession = {
    projectRoot: project.root,
    backend: 'bob',
    child,
    pid: child.pid,
    exe,
    logs: existing?.logs ?? new LogBuffer(),
    startedAt: Date.now(),
    consoleSeen: 0,
    manifest: existing?.manifest,
  };
  session.logs.appendLines([`--- engine started ${new Date().toISOString()} (${path.basename(exe)}) ---`]);
  setSession(session);
  registerEngine(child, exe, project.root);

  const onData = (d: Buffer) => {
    const s = d.toString('utf8');
    session.logs.append(s);
    if (!session.serviceUrl) {
      const m = /Engine service started on port (\d+)/.exec(s);
      if (m) session.serviceUrl = `http://127.0.0.1:${m[1]}`;
    }
  };
  child.stdout?.on('data', onData);
  child.stderr?.on('data', onData);
  child.on('exit', (code, signal) => {
    session.logs.flush();
    session.exited = { code, signal };
    session.logs.appendLines([`--- engine exited with code ${code}${signal ? ` (${signal})` : ''} ---`]);
    unregisterEngine(child.pid);
  });
  child.on('error', (err) => {
    session.exited = { code: null, signal: null };
    session.logs.appendLines([`--- failed to start engine: ${err.message} ---`]);
  });

  // Wait for the engine service so reload/inspect work right away.
  const deadline = Date.now() + 20_000;
  while (!session.serviceUrl && !session.exited && Date.now() < deadline) await sleep(100);
  return session;
}

/** Track a game the editor launched (we know its engine service URL). */
export function attachEditorSession(
  project: DefoldProject,
  editor: EditorConnection,
  serviceUrl: string | undefined,
  consoleSeen: number,
  consoleTail?: string,
): EngineSession {
  const existing = sessions.get(project.root);
  const session: EngineSession = {
    projectRoot: project.root,
    backend: 'editor',
    serviceUrl,
    editor,
    logs: existing?.logs ?? new LogBuffer(),
    startedAt: Date.now(),
    consoleSeen,
    consoleTail,
  };
  setSession(session);
  return session;
}

/**
 * Track a debug engine started outside this plugin and the editor (a device, a debug bundle, a dmengine started by
 * hand) by its engine service address, and stream its log. Only lines logged after connecting are captured.
 */
export async function attachExternalSession(
  project: DefoldProject,
  host: string,
  port: number,
): Promise<{ session: EngineSession; info: EngineInfo; logPort?: number; logError?: string }> {
  const serviceUrl = `http://${host.includes(':') ? `[${host}]` : host}:${port}`;
  if (!(await pingEngine(serviceUrl))) {
    throw new Error(
      `No Defold engine service answers at ${serviceUrl}. Only debug builds run it; it listens on port 8001 unless the engine ` +
        `printed another one ("Engine service started on port N"). For a device, use its IP address on the same network.`,
    );
  }
  const info = await engineInfo(serviceUrl).catch((): EngineInfo => ({}));
  const existing = sessions.get(project.root);
  if (existing?.backend === 'bob' && isRunning(existing) && existing.serviceUrl !== serviceUrl) await stopSession(existing);
  const session: EngineSession = {
    projectRoot: project.root,
    backend: 'attached',
    serviceUrl,
    logs: existing?.logs ?? new LogBuffer(),
    startedAt: Date.now(),
    consoleSeen: 0,
  };
  session.logs.appendLines([`--- attached to ${serviceUrl} ${new Date().toISOString()} ---`]);
  setSession(session);

  const logPort = Number(info.log_port);
  if (!logPort) return { session, info, logError: 'the engine service did not report a log port' };
  try {
    session.logSocket = await connectLogService(host, logPort, session.logs, () => {
      if (!session.logSocket) return;
      void pingEngine(serviceUrl).then((alive) => {
        session.logs.appendLines([alive ? '--- log stream closed (the engine still answers) ---' : '--- engine stopped (log stream closed) ---']);
        if (!alive) session.exited ??= { code: null, signal: null };
      });
    });
    return { session, info, logPort };
  } catch (err) {
    return { session, info, logPort, logError: (err as Error).message };
  }
}

/** Copy new editor console lines into the session log buffer. */
export async function syncEditorConsole(session: EngineSession): Promise<void> {
  if (session.backend !== 'editor' || !session.editor) return;
  const { lines } = await editorConsole(session.editor);
  const replaced =
    lines.length < session.consoleSeen ||
    (session.consoleSeen > 0 && session.consoleTail !== undefined && lines[session.consoleSeen - 1] !== session.consoleTail);
  if (replaced) session.consoleSeen = 0; // the editor clears the console when it launches a game
  session.logs.appendLines(lines.slice(session.consoleSeen));
  session.consoleSeen = lines.length;
  session.consoleTail = lines[lines.length - 1];
  if (session.serviceUrl && !(await pingEngine(session.serviceUrl))) session.exited ??= { code: null, signal: null };
}

/** Find the engine service of a game the user started from the editor (from its console output). */
export async function discoverEditorTarget(editor: EditorConnection): Promise<{ serviceUrl?: string }> {
  const { lines } = await editorConsole(editor);
  for (let i = lines.length - 1; i >= 0; i--) {
    const m = /Engine service started on port (\d+)/.exec(lines[i]!);
    if (m) {
      const url = `http://127.0.0.1:${m[1]}`;
      if (await pingEngine(url)) return { serviceUrl: url };
      break;
    }
  }
  return {};
}

export async function pingEngine(serviceUrl: string): Promise<boolean> {
  try {
    const res = await fetch(`${serviceUrl}/ping`, { signal: AbortSignal.timeout(1500) });
    return res.ok;
  } catch {
    return false;
  }
}

export async function postToEngine(session: EngineSession, target: string, body: Buffer = Buffer.alloc(0)): Promise<string> {
  if (!session.serviceUrl) throw new Error('The engine service URL is unknown (is the game running a debug build?).');
  const res = await fetch(`${session.serviceUrl}/post/${target}`, { method: 'POST', body, signal: AbortSignal.timeout(5000) });
  const text = await res.text();
  if (!res.ok) throw new Error(`Engine rejected ${target}: HTTP ${res.status} ${text}`);
  return text.trim();
}

export async function stopSession(session: EngineSession): Promise<void> {
  if (session.exited) return;
  try {
    if (session.serviceUrl) await postToEngine(session, '@system/exit', encodeExit(0));
  } catch (err) {
    logDebug('exit message failed', err);
  }
  if (session.child) {
    const deadline = Date.now() + 4000;
    while (!session.exited && Date.now() < deadline) await sleep(100);
    if (!session.exited) {
      await killTree(session.child.pid);
      await sleep(300);
      session.exited ??= { code: null, signal: 'SIGKILL' };
      unregisterEngine(session.child.pid);
    }
  } else {
    // An attached engine is gone once its log stream closes; otherwise give the editor's game a moment to quit.
    const deadline = Date.now() + (session.logSocket ? 4000 : 500);
    while (!session.exited && Date.now() < deadline) await sleep(100);
    session.exited ??= { code: 0, signal: null };
    closeLogStream(session);
  }
}

export async function engineCommand(session: EngineSession, command: string, width?: number, height?: number): Promise<string> {
  switch (command) {
    case 'toggle_physics_debug':
      return postToEngine(session, '@system/toggle_physics_debug');
    case 'toggle_profile':
      return postToEngine(session, '@system/toggle_profile');
    case 'resize':
      if (!width || !height) throw new Error('resize needs width and height');
      return postToEngine(session, '@render/resize', encodeResize(width, height));
    default:
      throw new Error(`Unknown engine command ${command}`);
  }
}

export async function sceneGraph(session: EngineSession): Promise<unknown> {
  if (!session.serviceUrl) throw new Error('The engine service URL is unknown.');
  const res = await fetch(`${session.serviceUrl}/scene_graph`, { signal: AbortSignal.timeout(10_000) });
  if (!res.ok) throw new Error(`scene_graph failed: HTTP ${res.status}`);
  const text = await res.text();
  // The engine emits JSON with non-standard float formatting in rare cases (nan/inf); sanitize.
  return JSON.parse(text.replace(/\b-?(nan|inf)\b/gi, '0'));
}

// ---------------------------------------------------------------------------------------------
// Hot reload support for headless sessions.

const NOT_RELOADABLE = new Set(['/game.projectc', '/_BobBuildState_', '/digest_cache']);

export async function hashBuildOutputs(projectRoot: string, previous?: Map<string, FileStamp>): Promise<Map<string, FileStamp>> {
  const root = path.join(projectRoot, ...AGENT_BUILD_DIR.split('/'));
  const out = new Map<string, FileStamp>();
  const stack = [root];
  while (stack.length) {
    const dir = stack.pop()!;
    let entries: fs.Dirent[] = [];
    try {
      entries = await fsp.readdir(dir, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const e of entries) {
      const p = path.join(dir, e.name);
      if (e.isDirectory()) {
        stack.push(p);
        continue;
      }
      const rel = '/' + path.relative(root, p).split(path.sep).join('/');
      const st = await fsp.stat(p);
      const prev = previous?.get(rel);
      if (prev && prev.size === st.size && prev.mtimeMs === st.mtimeMs) {
        out.set(rel, prev);
        continue;
      }
      const hash = crypto.createHash('sha1').update(await fsp.readFile(p)).digest('hex');
      out.set(rel, { size: st.size, mtimeMs: st.mtimeMs, hash });
    }
  }
  return out;
}

export function changedResources(before: Map<string, FileStamp>, after: Map<string, FileStamp>): string[] {
  const changed: string[] = [];
  for (const [rel, stamp] of after) {
    if (NOT_RELOADABLE.has(rel) || !/c$/.test(rel) || rel.endsWith('.compcount_go')) continue;
    const prev = before.get(rel);
    if (prev && prev.hash !== stamp.hash) changed.push(rel);
  }
  return changed.sort();
}

export async function reloadResources(session: EngineSession, resources: string[]): Promise<void> {
  for (const batch of encodeReloadBatches(resources)) await postToEngine(session, '@resource/reload', batch);
}

export function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}
