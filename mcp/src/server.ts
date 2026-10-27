import { McpServer } from '@modelcontextprotocol/server';
import { StdioServerTransport } from '@modelcontextprotocol/server/stdio';
import { registerTools, type ToolDef } from './tools/registry.js';
import { statusTool } from './tools/status.js';
import { buildTool } from './tools/build.js';
import { runTool } from './tools/run.js';
import { logsTool } from './tools/logs.js';
import { screenshotTool } from './tools/screenshot.js';
import { inspectTool } from './tools/inspect.js';
import { apiTool } from './tools/api.js';
import { docsTool } from './tools/docs.js';
import { readResourceTool } from './tools/readResource.js';
import { editResourceTool } from './tools/editResource.js';
import { validateTool } from './tools/validate.js';
import { findReferencesTool } from './tools/findReferences.js';
import { newProjectTool } from './tools/newProject.js';
import { inputTool } from './tools/input.js';
import { logInfo } from './util/log.js';
import { shutdownRuntime } from './runtime/lifecycle.js';
import { cleanupOrphanEngines } from './runtime/processes.js';

export const SERVER_VERSION = '0.2.7';

export const ALL_TOOLS: ToolDef[] = [
  statusTool,
  buildTool,
  runTool,
  logsTool,
  screenshotTool,
  inspectTool,
  apiTool,
  docsTool,
  readResourceTool,
  editResourceTool,
  validateTool,
  findReferencesTool,
  newProjectTool,
  inputTool,
] as unknown as ToolDef[];

export function createServer(): McpServer {
  const server = new McpServer(
    { name: 'defold', version: SERVER_VERSION },
    {
      instructions:
        'Tools for Defold game engine projects: build/run/inspect the game, read logs and screenshots, look up the ' +
        'installed version\'s Lua API and manuals, and read/edit/validate Defold resource files safely and find what references them. ' +
        'Call status first if unsure about the setup.',
    },
  );
  registerTools(server, ALL_TOOLS);
  return server;
}

async function main(): Promise<void> {
  const server = createServer();
  const transport = new StdioServerTransport();
  const stop = async (code: number) => {
    await shutdownRuntime().catch(() => {});
    process.exit(code);
  };
  process.on('SIGINT', () => void stop(0));
  process.on('SIGTERM', () => void stop(0));
  process.stdin.on('close', () => void stop(0));
  await server.connect(transport);
  logInfo(`Defold MCP server ${SERVER_VERSION} ready`);
  // Engines left behind by a crashed earlier session would keep windows open; clean them up quietly.
  void cleanupOrphanEngines().catch(() => {});
}

const isEntry = (() => {
  const arg = process.argv[1] ?? '';
  return /server\.(m?js|ts)$/.test(arg);
})();

if (isEntry) {
  main().catch((err) => {
    logInfo('fatal', err);
    process.exit(1);
  });
}
