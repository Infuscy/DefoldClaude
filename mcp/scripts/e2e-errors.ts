// End-to-end check of error reporting through the real MCP bundle: errors logged once in init must stay visible
// in the run report and in logs next to an error that repeats every frame, even after the log ring buffer wraps.
// Usage: npx tsx scripts/e2e-errors.ts [project]   (default: the basic eval fixture; always runs on a temp copy)
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Client } from '@modelcontextprotocol/client';
import { StdioClientTransport } from '@modelcontextprotocol/client/stdio';

const here = path.dirname(fileURLToPath(import.meta.url));
const serverPath = path.resolve(here, '../../plugins/defold/dist/server.mjs');
const source = path.resolve(process.argv[2] ?? path.join(here, '../../plugins/defold/evals/_fixtures/basic'));
const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'defold e2e '));
const project = path.join(tmpRoot, 'My Game');
fs.cpSync(source, project, { recursive: true, filter: (p) => !/[\\/](build|\.internal)$/.test(p) });
console.log('project:', project);

// The fixture's /main/player.script sits on game object "player" next to a sprite component "sprite".
fs.writeFileSync(
  path.join(project, 'main', 'player.script'),
  [
    'function init(self)',
    '\tmsg.post("/no_such_object", "hello")',
    '\tmsg.post("#no_such_component", "hello")',
    '\tsprite.play_flipbook("#sprite", "no_such_animation")',
    '\tprint("errors e2e init")',
    'end',
    '',
    'function update(self, dt)',
    '\tlocal t = nil',
    '\tlocal x = t.field',
    'end',
    '',
  ].join('\n'),
);

const env: Record<string, string> = {};
for (const [k, v] of Object.entries(process.env)) if (v !== undefined) env[k] = v;
env.DEFOLD_PROJECT_DIR = project;
const transport = new StdioClientTransport({ command: process.execPath, args: [serverPath], env, stderr: 'inherit' });
const client = new Client({ name: 'defold-e2e-errors', version: '0.0.1' });
await client.connect(transport);

async function call(name: string, args: Record<string, unknown> = {}, quiet = false): Promise<string> {
  const res = await client.callTool({ name, arguments: args });
  const text = (res.content as Array<{ type: string; text?: string }>).filter((b) => b.type === 'text').map((b) => b.text).join('\n');
  if (!quiet) console.log(`\n===== ${name} ${JSON.stringify(args)}${res.isError ? ' [isError]' : ''}\n${text.length > 4000 ? text.slice(0, 4000) + '\n…' : text}`);
  return text;
}

const failures: string[] = [];
function expectIn(label: string, text: string, ...patterns: RegExp[]) {
  for (const re of patterns) if (!re.test(text)) failures.push(`${label}: missing ${re}`);
}
const initErrors = [/no_such_object/, /no_such_component/, /no_such_animation/];
const updateError = /player\.script:10: attempt to index (local 't' )?\(?a nil value/;

try {
  const report = await call('run', { action: 'start', backend: 'bob', wait_seconds: 2 });
  expectIn('run report', report, ...initErrors, updateError, /errors e2e init/);
  const reportLines = report.split('\n').length;
  if (reportLines > 120) failures.push(`run report: ${reportLines} lines, expected repeats to be folded`);

  // Wait until the ring buffer (20,000 lines) has dropped the init lines.
  const started = Date.now();
  let cursor = 0;
  while (Date.now() - started < 120_000) {
    const m = /Next cursor: (\d+)/.exec(await call('logs', { level: 'error', max_lines: 1 }, true));
    cursor = Number(m?.[1] ?? 0);
    if (cursor > 21_000) break;
    await new Promise((r) => setTimeout(r, 2000));
  }
  console.log(`\nlog cursor after waiting: ${cursor} (${Math.round((Date.now() - started) / 1000)} s)`);
  if (cursor <= 21_000) failures.push(`the game did not log enough to wrap the buffer (cursor ${cursor})`);

  const logs = await call('logs', { level: 'error', max_lines: 40 });
  expectIn('logs after wrap', logs, ...initErrors, updateError);
  const since = await call('logs', { cursor: cursor, level: 'error', max_lines: 40 });
  expectIn('logs since cursor', since, updateError);
  for (const re of initErrors) if (re.test(since)) failures.push(`logs since cursor: init error ${re} reported again`);
} finally {
  await call('run', { action: 'stop' });
  await client.close();
  fs.rmSync(tmpRoot, { recursive: true, force: true });
}

console.log(failures.length ? `\nFAIL\n- ${failures.join('\n- ')}` : '\nPASS');
process.exit(failures.length ? 1 : 0);
