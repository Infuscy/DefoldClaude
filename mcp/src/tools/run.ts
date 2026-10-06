import { runBob, needsResolve } from '../runtime/bob.js';
import { editorCommand, editorConsole } from '../runtime/editor.js';
import {
  attachEditorSession,
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
    `Start, stop, restart or hot-reload the game, or send an engine command (toggle_physics_debug, toggle_profile, resize). start builds first, launches the engine (through the editor when open, else headless dmengine) and returns the first log lines plus any Lua errors seen within wait_seconds. reload pushes changed resources into the running game without restarting.`,
  inputSchema: runInput,
  annotations: { readOnlyHint: false },
  async handler(args, ctx) {
    const project = requireProject(args.project);
    return withLock(`run:${project.root}`, async () => {
      switch (args.action) {
        case 'start':
          return start(project, await chooseBackend(project, args.backend), args.wait_seconds, ctx.signal, ctx.progress);
        case 'restart': {
          const s = getSession(project.root);
          if (isRunning(s)) await stopSession(s);
          return start(project, await chooseBackend(project, args.backend), args.wait_seconds, ctx.signal, ctx.progress);
        }
        case 'stop': {
          const s = await currentSession(project);
          if (!isRunning(s)) return textResult('No running game for this project.');
          await stopSession(s);
          return textResult(`Stopped the game (${s.backend}).`, { stopped: true });
        }
        case 'reload':
          return reload(project, args.wait_seconds, ctx.signal);
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

async function start(
  project: DefoldProject,
  backend: Backend,
  waitSeconds: number,
  signal: AbortSignal,
  progress: (m: string, p?: number, t?: number) => Promise<void>,
) {
  if (backend.kind === 'editor') {
    const consoleBefore = (await editorConsole(backend.conn).catch(() => ({ lines: [] as string[] }))).lines;
    await progress('Building and launching through the Defold editor');
    const r = await editorBuildCommand(project, backend.conn, 'run', { query: { focus: 'false' }, signal });
    if (!r.success) {
      return textResult(`Run FAILED in the Defold editor.\n${summarizeIssues(r.issues)}`, { success: false, issues: r.issues });
    }
    const fromCursor = getSession(project.root)?.logs.cursor ?? 0;
    const session = attachEditorSession(project, backend.conn, r.targetUrl, consoleBefore.length, consoleBefore[consoleBefore.length - 1]);
    return report(session, waitSeconds, 'Started through the Defold editor', r.issues.length ? summarizeIssues(r.issues) : '', fromCursor);
  }

  const install = requireInstall();
  const existing = getSession(project.root);
  if (isRunning(existing)) await stopSession(existing);
  await progress('Building with bob');
  const build = await runBob(install, project, {
    commands: needsResolve(project) ? ['resolve', 'build'] : ['build'],
    variant: 'debug',
    signal,
    onProgress: (m, p) => void progress(m, p, 100),
  });
  if (!build.success) {
    return textResult(`Build FAILED — the game was not started.\n${summarizeIssues(build.issues)}`, { success: false, issues: build.issues });
  }
  await progress('Launching dmengine');
  const fromCursor = getSession(project.root)?.logs.cursor ?? 0;
  const session = await startHeadless(install, project);
  session.manifest = await hashBuildOutputs(project.root);
  if (!session.serviceUrl && !session.exited) {
    return textResult('The engine started but did not report its service port within 20 s. Check logs.');
  }
  return report(session, waitSeconds, `Started headless (${session.exe})`, '', fromCursor);
}

async function reload(project: DefoldProject, waitSeconds: number, signal: AbortSignal) {
  const s = await currentSession(project);
  if (!isRunning(s)) return errorResult('No running game to reload. Use run action=start.');
  const fromCursor = s.logs.cursor;
  if (s.backend === 'editor' && s.editor) {
    const r = await editorBuildCommand(project, s.editor, 'hot-reload', { signal });
    if (!r.success) return textResult(`Hot reload FAILED.\n${summarizeIssues(r.issues)}`, { success: false, issues: r.issues });
    return report(s, waitSeconds, 'Hot-reloaded through the Defold editor', '', fromCursor);
  }
  const install = requireInstall();
  const before = s.manifest ?? (await hashBuildOutputs(project.root));
  const build = await runBob(install, project, { commands: ['build'], variant: 'debug', signal });
  if (!build.success) return textResult(`Rebuild FAILED — nothing reloaded.\n${summarizeIssues(build.issues)}`, { success: false, issues: build.issues });
  const after = await hashBuildOutputs(project.root, before);
  s.manifest = after;
  const changed = changedResources(before, after);
  if (!changed.length) return textResult('Rebuilt; no compiled resources changed, nothing to reload.', { success: true, reloaded: [] });
  await reloadResources(s, changed);
  return report(s, waitSeconds, `Hot-reloaded ${changed.length} resource(s): ${changed.join(', ')}`, '', fromCursor);
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
  return textResult(parts.filter(Boolean).join('\n\n'), {
    running: !session.exited,
    backend: session.backend,
    service_url: session.serviceUrl,
    lua_errors: errors,
    cursor: session.logs.cursor,
  });
}
