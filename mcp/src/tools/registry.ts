import type { CallToolResult, McpServer, ServerContext, ToolAnnotations } from '@modelcontextprotocol/server';
import type * as z from 'zod/v4';
import { logInfo } from '../util/log.js';
import { errorResult } from './result.js';

export interface ToolContext {
  signal: AbortSignal;
  /** Report progress for long operations (no-op when the client did not ask for progress). */
  progress(message: string, progress?: number, total?: number): Promise<void>;
}

export interface ToolDef<S extends z.ZodObject = z.ZodObject> {
  name: string;
  title: string;
  description: string;
  inputSchema: S;
  annotations?: ToolAnnotations;
  handler: (args: z.output<S>, ctx: ToolContext) => Promise<CallToolResult>;
}

export function defineTool<S extends z.ZodObject>(def: ToolDef<S>): ToolDef<S> {
  return def;
}

export function registerTools(server: McpServer, tools: ToolDef[]): void {
  for (const tool of tools) {
    server.registerTool(
      tool.name,
      { title: tool.title, description: tool.description, inputSchema: tool.inputSchema, annotations: tool.annotations },
      async (args: unknown, ctx: ServerContext) => {
        const toolCtx = makeContext(ctx);
        try {
          return await tool.handler(args as never, toolCtx);
        } catch (err) {
          logInfo(`tool ${tool.name} failed`, err);
          return errorResult(err instanceof Error ? err.message : String(err));
        }
      },
    );
  }
}

function makeContext(ctx: ServerContext): ToolContext {
  const token = ctx.mcpReq._meta?.progressToken;
  let counter = 0;
  return {
    signal: ctx.mcpReq.signal,
    async progress(message, progress, total) {
      if (token === undefined) return;
      counter++;
      try {
        await ctx.mcpReq.notify({
          method: 'notifications/progress',
          params: { progressToken: token, progress: progress ?? counter, total, message },
        });
      } catch {
        // Progress is best effort.
      }
    },
  };
}
