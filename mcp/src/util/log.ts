// stdout belongs to the MCP stdio transport; all diagnostics go to stderr.
const debugEnabled = /^(1|true|yes)$/i.test(process.env.DEFOLD_MCP_DEBUG ?? '');

export function logInfo(message: string, ...rest: unknown[]): void {
  process.stderr.write(`[defold] ${message}${rest.length ? ' ' + rest.map(stringify).join(' ') : ''}\n`);
}

export function logDebug(message: string, ...rest: unknown[]): void {
  if (debugEnabled) logInfo(message, ...rest);
}

function stringify(value: unknown): string {
  if (value instanceof Error) return value.stack ?? value.message;
  if (typeof value === 'string') return value;
  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
}
