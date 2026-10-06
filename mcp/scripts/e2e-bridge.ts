// Drive a game that includes the Automation Bridge through the MCP tools.
// Usage: npx tsx scripts/e2e-bridge.ts "<project with the automation bridge dependency>"
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Client } from '@modelcontextprotocol/client';
import { StdioClientTransport } from '@modelcontextprotocol/client/stdio';

const here = path.dirname(fileURLToPath(import.meta.url));
const project = process.argv[2]!;
const env: Record<string, string> = {};
for (const [k, v] of Object.entries(process.env)) if (v !== undefined) env[k] = v;
env.DEFOLD_PROJECT_DIR = project;
const client = new Client({ name: 'e2e-bridge', version: '0' });
await client.connect(new StdioClientTransport({ command: process.execPath, args: [path.resolve(here, '../../plugins/defold/dist/server.mjs')], env, stderr: 'inherit' }));
let failures = 0;
async function call(name: string, args: Record<string, unknown>, expect?: RegExp) {
  const t0 = Date.now();
  const res = await client.callTool({ name, arguments: args });
  const blocks = res.content as Array<{ type: string; text?: string; data?: string }>;
  const text = blocks.filter((b) => b.type === 'text').map((b) => b.text).join('\n');
  const img = blocks.find((b) => b.type === 'image');
  if (img) fs.writeFileSync(path.join(os.tmpdir(), `bridge-${name}-${Date.now()}.png`), Buffer.from(img.data!, 'base64'));
  const ok = !res.isError && (!expect || expect.test(text));
  if (!ok) failures++;
  console.log(`\n===== ${name} ${JSON.stringify(args)} (${Date.now() - t0} ms) ${ok ? 'OK' : 'FAILED'}${img ? ' [image]' : ''}\n${text.slice(0, 1200)}`);
}
try {
  await call('run', { action: 'start', backend: 'bob', wait_seconds: 2 }, /AUTOMATIONBRIDGE/);
  await call('inspect', { elements: true, max_nodes: 20 }, /logo/);
  await call('input', { action: 'click', target: 'logo' }, /Touch!/);
  await call('input', { action: 'click', x: 0.5, y: 0.2, normalized: true, screenshot: true }, /Touch!/);
  await call('input', { action: 'key', keys: ['KEY_SPACE'] }, /released/);
  await call('screenshot', { max_size: 512 }, /captured in-engine/);
  await call('run', { action: 'stop' }, /Stopped/);
} finally {
  await client.close();
}
console.log(failures ? `\nFAILURES: ${failures}` : '\nALL CHECKS PASSED');
process.exit(failures ? 1 : 0);
