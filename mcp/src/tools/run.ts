import crypto from 'node:crypto';
import fsp from 'node:fs/promises';
import path from 'node:path';
import { buildHeadless, runBob } from '../runtime/bob.js';
import { editorCommand, editorConsole } from '../runtime/editor.js';
import {
  attachEditorSession,
  attachExternalSession,
  changedResources,
  discoverEditorTarget,
  engineCommand,
  getSession,
  hashBuildOutputs,
  isRunning,
  reloadResources,
  sleep,
  startHeadless,
  stopSession,
  syncEditorConsole,
  type EngineSession,
} from '../runtime/engine.js';
import gameProjectJson from '../ddf/gameproject.generated.json' with { type: 'json' };
import { isCompiledSetting, type SettingsSchema } from '../ddf/gameproject.js';
import { cacheRoot } from '../env/platform.js';
import { locateResource } from '../env/projectfs.js';
import { normalizeProjectPath } from '../env/project.js';
import { summarizeIssues } from '../runtime/issues.js';
import { formatLuaError, isNoise } from '../runtime/logs.js';
import { withLock } from '../runtime/processes.js';
import { chooseBackend, editorBuildCommand, requireInstall, requireProject, type Backend } from './common.js';
import { defineTool } from './registry.js';
import { errorResult, textResult } from './result.js';
import { runInput } from './schemas.js';
import type { DefoldProject } from '../env/project.js';

export const runTool = defineTool({
  name: 'run',
  title: 'Run Defold game',
  description:
    `Start, stop, restart or hot-reload the game, or send an engine command (toggle_physics_debug, toggle_profile, resize). start builds first, launches the engine (through the editor when open, else headless dmengine) and returns the first log lines plus any Lua errors seen within wait_seconds. reload pushes changed resources into the running game without restarting. collection and config start the headless engine in another collection or with game.project overrides, to test one level or screen directly. attach connects to a debug build started some other way (a phone, a debug bundle, dmengine started by hand) through its engine service at host:port and streams its log; logs, inspect, input and command then work on it.`,
  inputSchema: runInput,
  annotations: { readOnlyHint: false },
  async handler(args, ctx) {
    const project = requireProject(args.project);
    return withLock(`run:${project.root}`, async () => {
      switch (args.action) {
        case 'start': {
          const launch = launchOptions(project, args.collection, args.config);
          return start(project, await launchBackend(project, args.backend, launch), args.wait_seconds, ctx.signal, ctx.progress, launch);
        }
        case 'restart': {
          const s = getSession(project.root);
          const previous = s?.launchConfig?.length ? { config: s.launchConfig, notes: [] } : undefined;
          const launch = launchOptions(project, args.collection, args.config) ?? previous;
          if (isRunning(s)) await stopSession(s);
          return start(project, await launchBackend(project, args.backend, launch), args.wait_seconds, ctx.signal, ctx.progress, launch);
        }
        case 'stop': {
          const s = await currentSession(project);
          if (!isRunning(s)) return textResult('No running game for this project.');
          await stopSession(s);
          return textResult(`Stopped the game (${s.backend}).`);
        }
        case 'reload':
          return reload(project, args.wait_seconds, ctx.signal);
        case 'attach':
          return attach(project, args.host ?? '127.0.0.1', args.port ?? 8001, args.wait_seconds);
        case 'command': {
          if (!args.command) return errorResult('action=command needs "command" (toggle_physics_debug, toggle_profile or resize).');
          const s = await currentSession(project);
          if (!isRunning(s) || !s.serviceUrl) return errorResult('No running game with a reachable engine service. Start it with run action=start.');
          const reply = await engineCommand(s, args.command, args.width, args.height);
          return textResult(`${args.command}: ${reply || 'OK'}`);
        }
      }
    });
  },
});

/** The session for this project, discovering a game the user launched from the editor if needed. */
export async function currentSession(project: DefoldProject): Promise<EngineSession | undefined> {
  const s = getSession(project.root);
  if (s?.backend === 'editor' && !s.exited) await syncEditorConsole(s).catch(() => {});
  if (isRunning(s)) return s;
  const backend = await chooseBackend(project, 'auto').catch(() => undefined);
  if (backend?.kind === 'editor') {
    const found = await discoverEditorTarget(backend.conn);
    // Start at console line 0 so the output of the user's run (already in the console) is included.
    if (found.serviceUrl) return attachEditorSession(project, backend.conn, found.serviceUrl, 0);
  }
  return s;
}

interface LaunchOptions {
  /** key=value pairs for dmengine --config. */
  config: string[];
  notes: string[];
}

const SETTINGS = (gameProjectJson as unknown as { sections: SettingsSchema }).sections;

/** Turn collection/config arguments into engine overrides; undefined when there are none. */
export function launchOptions(project: DefoldProject, collection?: string, config?: Record<string, string | number | boolean>): LaunchOptions | undefined {
  if (!collection && !config) return undefined;
  const out: LaunchOptions = { config: [], notes: [] };
  for (const [key, raw] of Object.entries(config ?? {})) {
    if (!/^[A-Za-z0-9_-]+\.[A-Za-z0-9_.#-]+$/.test(key)) throw new Error(`config key "${key}" must look like section.key, e.g. display.width.`);
    if (collection && key === 'bootstrap.main_collection') throw new Error('Pass the collection either as collection or as config bootstrap.main_collection, not both.');
    const dot = key.indexOf('.');
    const setting = SETTINGS[key.slice(0, dot)]?.[key.slice(dot + 1)];
    let value = typeof raw === 'boolean' ? (raw ? '1' : '0') : String(raw);
    if (!setting) out.notes.push(`"${key}" is not a game.project setting of this Defold version (passed anyway; native extensions read their own keys).`);
    else if (setting.type === 'resource' && isCompiledSetting(setting) && value && !value.endsWith('c')) value += 'c'; // the engine loads the built resource
    out.config.push(`${key}=${value}`);
  }
  if (collection) {
    const { resource } = normalizeProjectPath(project, collection);
    const source = resource.replace(/\.collectionc$/, '.collection');
    if (!source.endsWith('.collection')) throw new Error(`collection must be a .collection file, got ${resource}.`);
    out.config.push(`bootstrap.main_collection=${source}c`);
  }
  return out;
}

/**
 * bob only builds what game.project reaches, so a collection booted instead of the main one must be the build root
 * too: pass it through a --settings file (applied over game.project for this build only).
 */
async function bootSettings(project: DefoldProject, config: string[] | undefined): Promise<string[] | undefined> {
  const main = config?.find((kv) => kv.startsWith('bootstrap.main_collection='));
  if (!main) return undefined;
  const file = path.join(cacheRoot(), 'launch', `${crypto.createHash('sha1').update(project.root).digest('hex').slice(0, 12)}.ini`);
  await fsp.mkdir(path.dirname(file), { recursive: true });
  await fsp.writeFile(file, `[bootstrap]\nmain_collection = ${main.slice(main.indexOf('=') + 1)}\n`);
  return ['--settings', file];
}

async function launchBackend(project: DefoldProject, requested: 'auto' | 'editor' | 'bob', launch: LaunchOptions | undefined): Promise<Backend> {
  if (!launch) return chooseBackend(project, requested);
  if (requested === 'editor') throw new Error('collection and config only apply to the headless engine; use backend=bob or auto.');
  return { kind: 'bob' };
}

async function start(
  project: DefoldProject,
  backend: Backend,
  waitSeconds: number,
  signal: AbortSignal,
  progress: (m: string, p?: number, t?: number) => Promise<void>,
  launch?: LaunchOptions,
) {
  if (backend.kind === 'editor') {
    const consoleBefore = (await editorConsole(backend.conn).catch(() => ({ lines: [] as string[] }))).lines;
    await progress('Building and launching through the Defold editor');
    const r = await editorBuildCommand(project, backend.conn, 'run', { query: { focus: 'false' }, signal });
    if (!r.success) {
      return textResult(`Run FAILED in the Defold editor.\n${summarizeIssues(r.issues)}`);
    }
    const fromCursor = getSession(project.root)?.logs.cursor ?? 0;
    const session = attachEditorSession(project, backend.conn, r.targetUrl, consoleBefore.length, consoleBefore[consoleBefore.length - 1]);
    return report(session, waitSeconds, 'Started through the Defold editor', r.issues.length ? summarizeIssues(r.issues) : '', fromCursor);
  }

  const install = requireInstall();
  const main = launch?.config.find((kv) => kv.startsWith('bootstrap.main_collection='))?.slice('bootstrap.main_collection='.length);
  if (main && !(await locateResource(project, main.replace(/c$/, '')))) {
    return errorResult(`${main.replace(/c$/, '')} does not exist; nothing was started.`);
  }
  const existing = getSession(project.root);
  if (isRunning(existing)) await stopSession(existing);
  await progress('Building with bob');
  const build = await buildHeadless(install, project, { signal, onProgress: (m, p) => void progress(m, p, 100), extra: await bootSettings(project, launch?.config) });
  if (!build.success) {
    return textResult(`Build FAILED — the game was not started.\n${summarizeIssues(build.issues)}`);
  }
  await progress('Launching dmengine');
  const fromCursor = getSession(project.root)?.logs.cursor ?? 0;
  const session = await startHeadless(install, project, launch?.config);
  session.manifest = await hashBuildOutputs(project.root);
  if (!session.serviceUrl && !session.exited) {
    return textResult('The engine started but did not report its service port within 20 s. Check logs.');
  }
  const overrides = launch?.config.length ? [`Overrides: ${launch.config.join(', ')}`, ...launch.notes].join('\n') : '';
  return report(session, waitSeconds, `Started headless (${session.exe})`, overrides, fromCursor);
}

async function reload(project: DefoldProject, waitSeconds: number, signal: AbortSignal) {
  const s = await currentSession(project);
  if (!isRunning(s)) return errorResult('No running game to reload. Use run action=start.');
  if (s.backend === 'attached') {
    return errorResult('Hot reload needs a game started by run action=start or by the Defold editor; an attached engine runs its own build. Rebuild and redeploy it, or start the game here.');
  }
  const fromCursor = s.logs.cursor;
  if (s.backend === 'editor' && s.editor) {
    const r = await editorBuildCommand(project, s.editor, 'hot-reload', { signal });
    if (!r.success) return textResult(`Hot reload FAILED.\n${summarizeIssues(r.issues)}`);
    return report(s, waitSeconds, 'Hot-reloaded through the Defold editor', '', fromCursor);
  }
  const install = requireInstall();
  const before = s.manifest ?? (await hashBuildOutputs(project.root));
  const build = await runBob(install, project, { commands: ['build'], variant: 'debug', signal, extra: await bootSettings(project, s.launchConfig) });
  if (!build.success) return textResult(`Rebuild FAILED — nothing reloaded.\n${summarizeIssues(build.issues)}`);
  const after = await hashBuildOutputs(project.root, before);
  s.manifest = after;
  const changed = changedResources(before, after);
  if (!changed.length) return textResult('Rebuilt; no compiled resources changed, nothing to reload.');
  await reloadResources(s, changed);
  return report(s, waitSeconds, `Hot-reloaded ${changed.length} resource(s): ${changed.join(', ')}`, '', fromCursor);
}

async function attach(project: DefoldProject, host: string, port: number, waitSeconds: number) {
  const fromCursor = getSession(project.root)?.logs.cursor ?? 0;
  const { session, info, logPort, logError } = await attachExternalSession(project, host, port);
  const engine = [info.version && `Defold ${info.version}`, info.platform].filter(Boolean).join(', ');
  const header = `Attached to the engine at ${session.serviceUrl}${engine ? ` (${engine})` : ''}`;
  const note = logError
    ? `No log stream: ${logError}. inspect and command still work.`
    : `Streaming its log from port ${logPort}. Only lines logged from now on are captured.`;
  return report(session, waitSeconds, header, note, fromCursor);
}

/** Wait, then summarize new log lines and Lua errors since the session (re)started. */
async function report(session: EngineSession, waitSeconds: number, header: string, extra: string, from: number) {
  const deadline = Date.now() + waitSeconds * 1000;
  while (Date.now() < deadline && !session.exited) {
    await sleep(250);
    if (session.backend === 'editor') await syncEditorConsole(session).catch(() => {});
  }
  if (session.backend === 'editor') await syncEditorConsole(session).catch(() => {});
  const { lines } = session.logs.query({ after: from, max: 80 });
  const shown = lines
    .filter((l) => !isNoise(l.text))
    .filter((l) => !/could not be reloaded since it was never loaded before/.test(l.text))
    .map((l) => l.text);
  const errors = session.logs.luaErrors(from);
  const status = session.exited ? `ENGINE EXITED (code ${session.exited.code ?? '?'})` : 'running';
  const parts = [
    `${header}. Game is ${status}.${session.serviceUrl ? ` Engine service: ${session.serviceUrl}` : ''}`,
    extra,
    errors.length ? `Lua errors (${errors.length}):\n${errors.slice(0, 10).map((e) => `- ${formatLuaError(e)}`).join('\n')}` : 'No Lua errors so far.',
    shown.length ? `Log (${shown.length} lines):\n${shown.join('\n')}` : '',
    `Log cursor: ${session.logs.cursor} (pass to logs to get only newer lines)`,
  ];
  return textResult(parts.filter(Boolean).join('\n\n'));
}
