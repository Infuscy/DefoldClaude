// Edit a temp copy of a Defold project through the MCP tools, then validate and build it with bob.
// Usage: npx tsx scripts/e2e-edit.ts "<path to a Defold project>"
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Client } from '@modelcontextprotocol/client';
import { StdioClientTransport } from '@modelcontextprotocol/client/stdio';

const here = path.dirname(fileURLToPath(import.meta.url));
const serverPath = path.resolve(here, '../../plugins/defold/dist/server.mjs');
const source = process.argv[2]!;
const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'defold edit '));
const project = path.join(tmpRoot, 'Game');
fs.cpSync(source, project, { recursive: true, filter: (p) => !/[\\/](build|\.internal)([\\/]|$)/.test('/' + path.relative(source, p)) });
fs.writeFileSync(path.join(project, 'main', 'enemy.script'), 'go.property("speed", 50)\n\nfunction update(self, dt)\n\tlocal p = go.get_position()\n\tp.x = p.x - self.speed * dt\n\tgo.set_position(p)\nend\n');
fs.writeFileSync(path.join(project, 'main', 'hud.gui_script'), 'function init(self)\n\tgui.set_text(gui.get_node("score"), "Score: 0")\nend\n');

const env: Record<string, string> = {};
for (const [k, v] of Object.entries(process.env)) if (v !== undefined) env[k] = v;
env.DEFOLD_PROJECT_DIR = project;
const client = new Client({ name: 'defold-e2e-edit', version: '0' });
await client.connect(new StdioClientTransport({ command: process.execPath, args: [serverPath], env, stderr: 'inherit' }));

let failures = 0;
async function call(name: string, args: Record<string, unknown>, expectOk = true) {
  const res = await client.callTool({ name, arguments: args });
  const text = (res.content as Array<{ text?: string }>).map((b) => b.text ?? '').join('\n');
  const ok = !res.isError;
  if (ok !== expectOk) failures++;
  console.log(`\n===== ${name} ${ok === expectOk ? 'OK' : 'UNEXPECTED'}\n${text.slice(0, 1800)}`);
  return text;
}

try {
  // 1. Add an embedded sprite to the existing embedded game object.
  await call('edit_resource', {
    path: '/main/main.collection',
    ops: [
      {
        op: 'insert',
        path: '/embedded_instances[id=go]/data/embedded_components',
        value: { id: 'badge', type: 'sprite', data: { default_animation: 'icon_180', material: '/builtins/materials/sprite.material', textures: [{ sampler: 'texture_sampler', texture: '/main/main.atlas' }] }, position: { y: 200, z: 0.1 }, scale: { x: 0.5, y: 0.5 } },
      },
    ],
  });
  // 2. Create a game object file with a script and an embedded sprite.
  await call('edit_resource', {
    path: '/main/enemy.go',
    create: true,
    ops: [
      { op: 'insert', path: '/components', value: { id: 'enemy', component: '/main/enemy.script' } },
      { op: 'insert', path: '/embedded_components', value: { id: 'sprite', type: 'sprite', data: { default_animation: 'icon_180', textures: [{ sampler: 'texture_sampler', texture: '/main/main.atlas' }] } } },
    ],
  });
  // 3. Place it in the collection with a script property override.
  await call('edit_resource', {
    path: '/main/main.collection',
    ops: [
      { op: 'insert', path: '/instances', value: { id: 'enemy', prototype: '/main/enemy.go', position: { x: 600, y: 900 } } },
      { op: 'insert', path: '/instances[id=enemy]/component_properties', value: { id: 'enemy', properties: [{ id: 'speed', value: '120.0', type: 'PROPERTY_TYPE_NUMBER' }] } },
    ],
  });
  // 4. A GUI scene with a text node, referenced from the collection.
  await call('edit_resource', {
    path: '/main/hud.gui',
    create: true,
    ops: [
      { op: 'set', path: '/script', value: '/main/hud.gui_script' },
      { op: 'insert', path: '/fonts', value: { name: 'default', font: '/builtins/fonts/default.font' } },
      { op: 'insert', path: '/nodes', value: { position: { x: 20, y: 1100 }, size: { x: 200, y: 40 }, type: 'TYPE_TEXT', text: 'Score: 0', font: 'default', id: 'score', pivot: 'PIVOT_NW' } },
    ],
  });
  await call('edit_resource', { path: '/main/main.collection', ops: [{ op: 'insert', path: '/embedded_instances', value: { id: 'hud', data: { components: [{ id: 'hud', component: '/main/hud.gui' }] } } }] });
  // 5. Mistakes are refused with a helpful message (expected failures).
  await call('edit_resource', { path: '/main/main.collection', ops: [{ op: 'set', path: '/embedded_instances[id=go]/data/embedded_components[id=badge]/data/blend_mode', value: 'SUPERBRIGHT' }] }, false);
  await call('edit_resource', { path: '/main/main.collection', ops: [{ op: 'insert', path: '/instances', value: { id: 'enemy', prototype: '/main/enemy.go' } }] }, false);
  // 6. Read back, validate and build.
  await call('read_resource', { path: '/main/main.collection', select: '/instances[id=enemy]' });
  const v = await call('validate', {});
  if (!/0 error\(s\)/.test(v)) failures++;
  const b = await call('build', { backend: 'bob' });
  if (!/build succeeded/.test(b)) failures++;
  console.log('\n----- final main.collection -----\n' + fs.readFileSync(path.join(project, 'main', 'main.collection'), 'utf8'));
} finally {
  await client.close();
  fs.rmSync(tmpRoot, { recursive: true, force: true });
}
console.log(failures ? `\nFAILURES: ${failures}` : '\nALL CHECKS PASSED');
process.exit(failures ? 1 : 0);
