import fs from 'node:fs';
import path from 'node:path';
import type { DefoldInstall } from '../env/locate.js';
import { cacheRoot, hostPlatform } from '../env/platform.js';
import type { DefoldProject } from '../env/project.js';
import { projectDependencies } from '../env/project.js';
import { isDir } from '../util/fsx.js';
import { AGENT_BUILD_DIR } from './enginebin.js';
import { cleanBobLog, parseBobOutput, type Issue } from './issues.js';
import { ZipFile } from '../env/zip.js';
import { runCommand } from './processes.js';

export interface BobRun {
  success: boolean;
  issues: Issue[];
  log: string;
  durationMs: number;
  timedOut: boolean;
  args: string[];
}

export interface BobOptions {
  commands: string[];
  platform?: string;
  variant?: string;
  bundleOutput?: string;
  archive?: boolean;
  buildServer?: string;
  extra?: string[];
  timeoutMs?: number;
  signal?: AbortSignal;
  onProgress?: (message: string, percent: number) => void;
}

const DEFAULT_BUILD_SERVER = 'https://build.defold.com';

export async function runBob(install: DefoldInstall, project: DefoldProject, options: BobOptions): Promise<BobRun> {
  if (!install.javaPath) throw new Error('No Java runtime found for bob (the Defold install looks incomplete). Run the status tool.');
  if (!install.jarPath) throw new Error('No bob/editor jar found. Run the status tool.');

  const bobArgs = ['--root', project.root, '--output', AGENT_BUILD_DIR];
  if (options.variant) bobArgs.push('--variant', options.variant);
  const needsEngine = !options.commands.every((c) => c === 'resolve' || c === 'distclean') && (await hasNativeExtensions(project));
  const platform = options.platform ?? (needsEngine ? hostPlatform() : undefined);
  if (platform) bobArgs.push('--platform', platform);
  if (needsEngine || options.buildServer) {
    bobArgs.push('--build-server', options.buildServer ?? DEFAULT_BUILD_SERVER);
    // Keep our custom engine apart from the editor's (which lives in build/<platform>).
    // bob appends /<platform>/ itself → build/agent/<platform>/dmengine(.exe)
    if (!options.commands.includes('bundle')) bobArgs.push('--binary-output', AGENT_BUILD_DIR);
  }
  if (options.archive) bobArgs.push('--archive');
  if (options.bundleOutput) bobArgs.push('--bundle-output', options.bundleOutput);
  if (options.extra) bobArgs.push(...options.extra);
  bobArgs.push(...options.commands);

  const javaArgs = [
    '--enable-native-access=ALL-UNNAMED',
    '-Djava.awt.headless=true',
    '-Dfile.encoding=UTF-8',
    '-cp',
    install.jarPath,
    'com.dynamo.bob.Bob',
    ...bobArgs,
  ];

  // A stable temp root keeps bob from littering %TEMP% with unpacked tool binaries on every run.
  const bobRoot = path.join(cacheRoot(), 'bob', install.sha1 ?? 'unknown');
  fs.mkdirSync(bobRoot, { recursive: true });

  const result = await runCommand(install.javaPath, javaArgs, {
    cwd: project.root,
    env: { ...process.env, DM_BOB_ROOTFOLDER: bobRoot },
    timeoutMs: options.timeoutMs ?? 900_000,
    signal: options.signal,
    onLine: (line) => {
      const m = /^\s*(\d+)% (.+)$/.exec(line);
      if (m && options.onProgress) options.onProgress(m[2]!, Number(m[1]));
    },
  });
  const issues = parseBobOutput(result.output);
  if (result.timedOut) issues.push({ severity: 'error', message: `bob timed out after ${Math.round((options.timeoutMs ?? 900_000) / 1000)} s` });
  const success = result.code === 0 && !result.timedOut && !issues.some((i) => i.severity === 'error');
  if (!success && !issues.length) {
    const tail = cleanBobLog(result.output).split('\n').slice(-15).join('\n');
    issues.push({ severity: 'error', message: `bob exited with code ${result.code}${tail ? `:\n${tail}` : ''}` });
  }
  return { success, issues, log: cleanBobLog(result.output), durationMs: result.durationMs, timedOut: result.timedOut, args: bobArgs };
}

/** Native extensions (ext.manifest in the project or a fetched library) need a custom engine from the build server. */
export async function hasNativeExtensions(project: DefoldProject): Promise<boolean> {
  if (hasExtensionInProject(project)) return true;
  const lib = path.join(project.root, '.internal', 'lib');
  let zips: string[] = [];
  try {
    zips = fs.readdirSync(lib).filter((f) => f.endsWith('.zip'));
  } catch {
    return false;
  }
  for (const z of zips) {
    let zip: ZipFile | undefined;
    try {
      zip = await ZipFile.open(path.join(lib, z));
      if ([...zip.entries.keys()].some((n) => n.endsWith('/ext.manifest') || n === 'ext.manifest')) return true;
    } catch {
      // unreadable archive
    } finally {
      zip?.close();
    }
  }
  return false;
}

function hasExtensionInProject(project: DefoldProject): boolean {
  const stack = [project.root];
  const skip = new Set(['build', '.internal', '.git', 'node_modules']);
  let visited = 0;
  while (stack.length && visited < 5000) {
    const dir = stack.pop()!;
    visited++;
    let entries: fs.Dirent[] = [];
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const e of entries) {
      if (e.isFile() && e.name === 'ext.manifest') return true;
      if (e.isDirectory() && !skip.has(e.name) && !e.name.startsWith('.')) stack.push(path.join(dir, e.name));
    }
  }
  // Library zips cannot be scanned cheaply here; dependencies that ship native code are detected by bob itself.
  return false;
}

/** True when the project declares dependencies that have not been fetched into .internal/lib yet. */
export function needsResolve(project: DefoldProject): boolean {
  const deps = projectDependencies(project);
  if (!deps.length) return false;
  const lib = path.join(project.root, '.internal', 'lib');
  if (!isDir(lib)) return true;
  const zips = fs.readdirSync(lib).filter((f) => f.endsWith('.zip'));
  return zips.length < deps.length;
}

/**
 * Headless build used by the build and run tools: fetch missing libraries first (as its own step, so that
 * native extensions inside libraries are detected), then build — with the cloud build server when needed.
 */
export async function buildHeadless(install: DefoldInstall, project: DefoldProject, options: Omit<BobOptions, 'commands'> = {}): Promise<BobRun> {
  if (needsResolve(project)) {
    options.onProgress?.('Fetching library dependencies', 0);
    const resolved = await runBob(install, project, { ...options, commands: ['resolve'] });
    if (!resolved.success) return resolved;
  }
  return runBob(install, project, { variant: 'debug', ...options, commands: ['build'] });
}
