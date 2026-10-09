import type { CallToolResult } from '@modelcontextprotocol/server';

/** Hard cap so a single result stays well below Claude Code's MCP output limit. */
export const DEFAULT_MAX_CHARS = 24_000;

// Results carry text (and images) only. Claude Code shows the model structuredContent *instead of* content
// when both are present, which would hide the log lines, docs, diffs and screenshots that are the answer.

export function textResult(text: string): CallToolResult {
  return { content: [{ type: 'text', text: clampText(text) }] };
}

export function errorResult(message: string): CallToolResult {
  return { content: [{ type: 'text', text: clampText(message) }], isError: true };
}

export function imageResult(pngBase64: string, caption: string): CallToolResult {
  return {
    content: [
      { type: 'text', text: caption },
      { type: 'image', data: pngBase64, mimeType: 'image/png' },
    ],
  };
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
