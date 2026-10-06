// End-to-end check of the build/run loop through the real MCP bundle on a temp copy of a Defold project.
// Usage: npx tsx scripts/e2e-run.ts "<path to a Defold project>" [backend=bob|editor|auto]
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Client } from '@modelcontextprotocol/client';
import { StdioClientTransport } from '@modelcontextprotocol/client/stdio';

const here = path.dirname(fileURLToPath(import.meta.url));
const serverPath = path.resolve(here, '../../plugins/defold/dist/server.mjs');
const source = process.argv[2];
const backend = process.argv[3] ?? 'bob';
const keep = process.argv.includes('--keep');
if (!source) throw new Error('pass a project path');

const inPlace = process.argv.includes('--in-place');
const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'defold e2e '));
const project = inPlace ? path.resolve(source) : path.join(tmpRoot, 'My Game');
if (!inPlace) {
  fs.cpSync(source, project, { recursive: true, filter: (p) => !/[\\/](build|\.internal)([\\/]|$)/.test(path.relative(source, p) ? '/' + path.relative(source, p) : '') });
}
console.log('project:', project);

const env: Record<string, string> = {};
for (const [k, v] of Object.entries(process.env)) if (v !== undefined) env[k] = v;
env.DEFOLD_PROJECT_DIR = project;
const transport = new StdioClientTransport({ command: process.execPath, args: [serverPath], env, stderr: 'inherit' });
const client = new Client({ name: 'defold-e2e', version: '0.0.1' });
await client.connect(transport);

async function call(name: string, args: Record<string, unknown> = {}) {
  const t0 = Date.now();
  const res = await client.callTool({ name, arguments: args });
  const blocks = res.content as Array<{ type: string; text?: string; data?: string }>;
  console.log(`\n===== ${name} ${JSON.stringify(args)} (${Date.now() - t0} ms)${res.isError ? ' [isError]' : ''}`);
  for (const b of blocks) {
    if (b.type === 'text') console.log(b.text!.length > 2500 ? b.text!.slice(0, 2500) + '\n…' : b.text);
    else if (b.type === 'image') {
      const file = path.join(tmpRoot, `shot-${Date.now()}.png`);
      fs.writeFileSync(file, Buffer.from(b.data!, 'base64'));
      console.log(`[image saved to ${file}]`);
    }
  }
  return res;
}

const script = path.join(project, 'main', 'main.script');
try {
  await call('build', { backend });
  // Inject a runtime error and an on_reload handler to exercise log parsing and hot reload.
  fs.writeFileSync(
    script,
    'function init(self)\n\tmsg.post(".", "acquire_input_focus")\n\tprint("e2e init v1")\n\tlocal t = nil\n\tprint(t.boom)\nend\n\nfunction on_reload(self)\n\tprint("e2e reloaded")\nend\n',
  );
  await call('run', { action: 'start', backend, wait_seconds: 3 });
  await call('logs', { level: 'error' });
  await call('screenshot', { source: 'game', max_size: 512 });
  await call('inspect', { max_nodes: 40 });
  await call('run', { action: 'command', command: 'toggle_physics_debug' });
  fs.writeFileSync(script, 'function init(self)\n\tprint("e2e init v2")\nend\n\nfunction on_reload(self)\n\tprint("e2e reloaded v2")\nend\n');
  await call('run', { action: 'reload', wait_seconds: 2 });
  await call('logs', { grep: 'e2e' });
  await call('status');
  await call('run', { action: 'stop' });
  // Syntax error must come back as a structured issue.
  fs.writeFileSync(script, 'function init(self)\n\tprint("broken"\nend\n');
  await call('build', { backend });
} finally {
  await client.close();
  if (!keep) fs.rmSync(tmpRoot, { recursive: true, force: true });
}
