// MCP stdio smoke test against the built bundle:  npx tsx scripts/smoke.ts [projectDir] [toolName] [jsonArgs]
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Client } from '@modelcontextprotocol/client';
import { StdioClientTransport } from '@modelcontextprotocol/client/stdio';

const here = path.dirname(fileURLToPath(import.meta.url));
const serverPath = path.resolve(here, '../../plugins/defold/dist/server.mjs');
const [projectDir, toolName = 'status', jsonArgs = '{}'] = process.argv.slice(2);

const env: Record<string, string> = {};
for (const [k, v] of Object.entries(process.env)) if (v !== undefined) env[k] = v;
if (projectDir) env.DEFOLD_PROJECT_DIR = projectDir;

const transport = new StdioClientTransport({ command: process.execPath, args: [serverPath], env, stderr: 'inherit' });
const client = new Client({ name: 'defold-smoke', version: '0.0.1' });
await client.connect(transport);
const tools = await client.listTools();
console.log(`TOOLS (${tools.tools.length}): ${tools.tools.map((t) => t.name).join(', ')}`);
const started = Date.now();
const res = await client.callTool({ name: toolName, arguments: JSON.parse(jsonArgs) });
console.log(`--- ${toolName} (${Date.now() - started} ms) isError=${res.isError ?? false}`);
for (const block of res.content as Array<{ type: string; text?: string; data?: string; mimeType?: string }>) {
  if (block.type === 'text') console.log(block.text);
  else console.log(`[${block.type} ${block.mimeType ?? ''} ${block.data?.length ?? 0} base64 chars]`);
}
await client.close();
