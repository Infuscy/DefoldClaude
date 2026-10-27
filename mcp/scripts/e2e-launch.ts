// run action=start with collection/config overrides and screenshot bursts, on a temp copy of a Defold project.
// Adds /levels/level.collection whose script prints its config and moves its game object back and forth.
// Usage: npx tsx scripts/e2e-launch.ts "<path to a Defold project>" [--keep]
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Client } from '@modelcontextprotocol/client';
import { StdioClientTransport } from '@modelcontextprotocol/client/stdio';

const here = path.dirname(fileURLToPath(import.meta.url));
const serverPath = path.resolve(here, '../../plugins/defold/dist/server.mjs');
const source = process.argv[2];
if (!source) throw new Error('pass a project path');
const keep = process.argv.includes('--keep');
const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'defold launch '));
const project = path.join(tmpRoot, 'My Game');
fs.cpSync(source, project, { recursive: true, filter: (p) => !/[\\/](build|\.internal)([\\/]|$)/.test('/' + path.relative(source, p)) });
const main = fs.readFileSync(path.join(project, 'main', 'main.collection'), 'utf8');
if (!main.includes('/main/main.script')) throw new Error('expected the main collection to use /main/main.script');
fs.mkdirSync(path.join(project, 'levels'));
fs.writeFileSync(path.join(project, 'levels', 'level.collection'), main.replace('name: "main"', 'name: "level"').replace('/main/main.script', '/levels/mover.script'));
fs.writeFileSync(
  path.join(project, 'levels', 'mover.script'),
  'function init(self)\n\tprint("level booted width=" .. sys.get_config_int("display.width") .. " flag=" .. sys.get_config_string("test.flag", "none"))\n' +
    '\tgo.animate(".", "position.x", go.PLAYBACK_LOOP_PINGPONG, go.get_position().x + 200, go.EASING_LINEAR, 1.2)\nend\n',
);

const env: Record<string, string> = {};
for (const [k, v] of Object.entries(process.env)) if (v !== undefined) env[k] = v;
env.DEFOLD_PROJECT_DIR = project;
const client = new Client({ name: 'defold-e2e-launch', version: '0.0.1' });
await client.connect(new StdioClientTransport({ command: process.execPath, args: [serverPath], env, stderr: 'inherit' }));

const failures: string[] = [];
async function call(name: string, args: Record<string, unknown>, expect?: RegExp, saveAs?: string) {
  const res = await client.callTool({ name, arguments: args });
  const blocks = res.content as Array<{ type: string; text?: string; data?: string }>;
  const text = blocks.filter((b) => b.type === 'text').map((b) => b.text).join('\n');
  console.log(`\n===== ${name} ${JSON.stringify(args)}${res.isError ? ' [isError]' : ''}`);
  console.log(text.length > 1500 ? text.slice(0, 1500) + '\n…' : text);
  const image = blocks.find((b) => b.type === 'image');
  if (image && saveAs) {
    fs.writeFileSync(path.join(tmpRoot, saveAs), Buffer.from(image.data!, 'base64'));
    console.log(`[image saved to ${path.join(tmpRoot, saveAs)}]`);
  }
  if (expect && !expect.test(text)) failures.push(`${name} ${JSON.stringify(args)}: expected ${expect}`);
  return text;
}

try {
  await call(
    'run',
    { action: 'start', collection: '/levels/level.collection', config: { 'display.width': 480, 'test.flag': 'hello' }, wait_seconds: 2 },
    /Overrides: display\.width=480, test\.flag=hello, bootstrap\.main_collection=\/levels\/level\.collectionc\n"test\.flag" is not a game\.project setting[\s\S]*level booted width=480 flag=hello/,
  );
  await call('inspect', { max_nodes: 10 }, /^Scene graph[\s\S]*level \[collectionc\] \/levels\/level\.collectionc/);
  const moving = await call('screenshot', { frames: 6, interval_ms: 200, max_size: 768 }, /^6 frames \(game window, \d+x\d+\)[\s\S]*numbered 1–6[\s\S]*Pixels changed from frame to frame: 1→2 [\d.]+%/, 'moving.png');
  if (/static during the burst/.test(moving)) failures.push('the moving level looked static');
  await call('run', { action: 'restart', wait_seconds: 2 }, /Overrides: display\.width=480[\s\S]*level booted width=480 flag=hello/);
  await call('run', { action: 'start', wait_seconds: 2 }, /Started headless/);
  await call('inspect', { max_nodes: 10 }, /main \[collectionc\] \/main\/main\.collectionc/);
  await call('screenshot', { frames: 3, interval_ms: 200, max_size: 512 }, /1→2 0%, 2→3 0%\. Nothing changed between frames/, 'static.png');
  await call('screenshot', { max_size: 256 }, /^Game window \d+x\d+/);
  await call('run', { action: 'start', collection: '/levels/missing.collection' }, /\/levels\/missing\.collection does not exist; nothing was started/);
  await call('run', { action: 'stop' }, /Stopped the game/);
} finally {
  await client.close();
  if (!keep) fs.rmSync(tmpRoot, { recursive: true, force: true });
}
if (failures.length) {
  console.error(`\nFAILED:\n${failures.map((f) => `- ${f}`).join('\n')}`);
  process.exit(1);
}
console.log('\nlaunch/burst e2e passed');
