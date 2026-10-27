// Start dmengine outside the MCP server (as on a device or from a debug bundle), then attach to it with run action=attach
// and check logs, inspect, command, screenshot, reload refusal and stop on a temp copy of a Defold project.
// Usage: npx tsx scripts/e2e-attach.ts "<path to a Defold project>"
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Client } from '@modelcontextprotocol/client';
import { StdioClientTransport } from '@modelcontextprotocol/client/stdio';
import { locateDefold } from '../src/env/locate.js';
import { resolveEngineBinary } from '../src/runtime/enginebin.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const serverPath = path.resolve(here, '../../plugins/defold/dist/server.mjs');
const source = process.argv[2];
if (!source) throw new Error('pass a project path');
const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'defold attach '));
const project = path.join(tmpRoot, 'My Game');
fs.cpSync(source, project, { recursive: true, filter: (p) => !/[\\/](build|\.internal)([\\/]|$)/.test('/' + path.relative(source, p)) });
fs.writeFileSync(
  path.join(project, 'main', 'main.script'),
  'function init(self)\n\tprint("attach init")\n\tself.n = 0\n\ttimer.delay(0.25, true, function()\n\t\tself.n = self.n + 1\n\t\tprint("attach tick " .. self.n)\n\t\tif self.n == 6 then local t = nil; print(t.boom) end\n\tend)\nend\n',
);

const env: Record<string, string> = {};
for (const [k, v] of Object.entries(process.env)) if (v !== undefined) env[k] = v;
env.DEFOLD_PROJECT_DIR = project;
const client = new Client({ name: 'defold-e2e-attach', version: '0.0.1' });
await client.connect(new StdioClientTransport({ command: process.execPath, args: [serverPath], env, stderr: 'inherit' }));

const failures: string[] = [];
async function call(name: string, args: Record<string, unknown>, expect?: RegExp) {
  const res = await client.callTool({ name, arguments: args });
  const blocks = res.content as Array<{ type: string; text?: string }>;
  const text = blocks.filter((b) => b.type === 'text').map((b) => b.text).join('\n');
  const images = blocks.filter((b) => b.type === 'image').length;
  console.log(`\n===== ${name} ${JSON.stringify(args)}${res.isError ? ' [isError]' : ''}${images ? ` [${images} image]` : ''}`);
  console.log(text.length > 2000 ? text.slice(0, 2000) + '\n…' : text);
  if (expect && !expect.test(text)) failures.push(`${name} ${JSON.stringify(args)}: expected ${expect}`);
  return { text, images, isError: !!res.isError };
}

let engine: ReturnType<typeof spawn> | undefined;
try {
  await call('build', { backend: 'bob' }, /build succeeded/);
  // Launched by this script, not by the server: the server only knows its address.
  const exe = await resolveEngineBinary(locateDefold().install!, project);
  engine = spawn(exe, ['--config=resource.uri=build/agent', 'build/agent/game.projectc'], {
    cwd: project,
    env: { ...process.env, DM_SERVICE_PORT: 'dynamic' },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  const port = await new Promise<number>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('engine did not report its service port')), 20_000);
    engine!.stdout!.on('data', (d: Buffer) => {
      const m = /Engine service started on port (\d+)/.exec(d.toString());
      if (m) {
        clearTimeout(timer);
        resolve(Number(m[1]));
      }
    });
  });
  const exited = new Promise<number | null>((r) => engine!.on('exit', (code) => r(code)));

  await call('run', { action: 'attach', port, wait_seconds: 2 }, /Attached to the engine at http:\/\/127\.0\.0\.1:\d+ \(Defold [\d.]+, [\w-]+\)[\s\S]*attach tick/);
  await call('logs', { grep: 'attach tick' }, /attach tick 6/);
  await call('logs', { level: 'error' }, /Lua errors in this range \(1\):\n- \/main\/main\.script:7/);
  await call('inspect', { max_nodes: 20 }, /main\.script/);
  await call('run', { action: 'command', command: 'toggle_physics_debug' }, /toggle_physics_debug: /);
  const shot = await call('screenshot', { source: 'game', max_size: 256 });
  if (shot.images !== 1) failures.push('screenshot: expected an image of the attached local engine');
  await call('run', { action: 'reload' }, /attached engine runs its own build/);
  await call('status', {}, /via attached/);
  await call('run', { action: 'stop' }, /Stopped the game \(attached\)/);
  const code = await Promise.race([exited, new Promise((r) => setTimeout(() => r('still running'), 5000))]);
  console.log('\nengine exit:', code);
  if (code === 'still running') failures.push('the engine did not exit after run action=stop');
  await call('logs', { max_lines: 3 }, /Game exited/);
} finally {
  await client.close();
  if (engine && engine.exitCode === null) engine.kill();
  fs.rmSync(tmpRoot, { recursive: true, force: true });
}
if (failures.length) {
  console.error(`\nFAILED:\n${failures.map((f) => `- ${f}`).join('\n')}`);
  process.exit(1);
}
console.log('\nattach e2e passed');
