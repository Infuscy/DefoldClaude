// Kill the MCP server while a headless game runs, then verify the next server start kills the orphaned engine.
// Usage: npx tsx scripts/e2e-orphan.ts "<path to a Defold project>"
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Client } from '@modelcontextprotocol/client';
import { StdioClientTransport } from '@modelcontextprotocol/client/stdio';

const here = path.dirname(fileURLToPath(import.meta.url));
const serverPath = path.resolve(here, '../../plugins/defold/dist/server.mjs');
const source = process.argv[2]!;
const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'defold orphan '));
const project = path.join(tmpRoot, 'Game');
fs.cpSync(source, project, { recursive: true, filter: (p) => !/[\\/](build|\.internal)([\\/]|$)/.test('/' + path.relative(source, p)) });

const env: Record<string, string> = {};
for (const [k, v] of Object.entries(process.env)) if (v !== undefined) env[k] = v;
env.DEFOLD_PROJECT_DIR = project;

const engines = () => {
  const out = execFileSync('tasklist', ['/FI', 'IMAGENAME eq dmengine.exe', '/FO', 'CSV', '/NH'], { encoding: 'utf8' });
  return out.split(/\r?\n/).filter((l) => l.includes('dmengine.exe')).length;
};

const t1 = new StdioClientTransport({ command: process.execPath, args: [serverPath], env, stderr: 'ignore' });
const c1 = new Client({ name: 'orphan-1', version: '0' });
await c1.connect(t1);
await c1.callTool({ name: 'run', arguments: { action: 'start', backend: 'bob', wait_seconds: 1 } });
console.log('engines while running:', engines());
const serverPid = (t1 as unknown as { pid?: number }).pid ?? (t1 as unknown as { _process?: { pid: number } })._process?.pid;
console.log('server pid', serverPid);
if (serverPid) execFileSync('taskkill', ['/PID', String(serverPid), '/F']);
await new Promise((r) => setTimeout(r, 1500));
console.log('engines after killing server:', engines());

const t2 = new StdioClientTransport({ command: process.execPath, args: [serverPath], env, stderr: 'ignore' });
const c2 = new Client({ name: 'orphan-2', version: '0' });
await c2.connect(t2);
await new Promise((r) => setTimeout(r, 3000));
console.log('engines after new server start:', engines());
await c2.close();
fs.rmSync(tmpRoot, { recursive: true, force: true });
