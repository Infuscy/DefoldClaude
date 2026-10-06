import type { CallToolResult } from '@modelcontextprotocol/server';

/** Hard cap so a single result stays well below Claude Code's MCP output limit. */
export const DEFAULT_MAX_CHARS = 24_000;

export function textResult(text: string, structured?: Record<string, unknown>): CallToolResult {
  const result: CallToolResult = { content: [{ type: 'text', text: clampText(text) }] };
  if (structured) result.structuredContent = structured;
  return result;
}

export function errorResult(message: string, structured?: Record<string, unknown>): CallToolResult {
  const result: CallToolResult = { content: [{ type: 'text', text: clampText(message) }], isError: true };
  if (structured) result.structuredContent = structured;
  return result;
}

export function imageResult(pngBase64: string, caption: string, structured?: Record<string, unknown>): CallToolResult {
  const result: CallToolResult = {
    content: [
      { type: 'text', text: caption },
      { type: 'image', data: pngBase64, mimeType: 'image/png' },
    ],
  };
  if (structured) result.structuredContent = structured;
  return result;
}

export function clampText(text: string, maxChars = DEFAULT_MAX_CHARS): string {
  if (text.length <= maxChars) return text;
  const head = text.slice(0, maxChars - 200);
  return `${head}\n… [truncated ${text.length - head.length} characters; narrow the request or use paging parameters]`;
}

/** Page through a long text: returns the slice plus a hint for the next offset. */
export function pageText(text: string, offset: number, maxChars: number): { text: string; nextOffset?: number } {
  const start = Math.max(0, Math.min(offset, text.length));
  const end = Math.min(text.length, start + maxChars);
  let slice = text.slice(start, end);
  // Prefer to cut at a line boundary.
  if (end < text.length) {
    const lastNl = slice.lastIndexOf('\n');
    if (lastNl > maxChars * 0.5) slice = slice.slice(0, lastNl + 1);
  }
  const next = start + slice.length;
  return { text: slice, nextOffset: next < text.length ? next : undefined };
}
