// Ring buffer of engine log lines with cursors, level filtering and Lua error extraction.

export type LogLevel = 'debug' | 'info' | 'warning' | 'error' | 'fatal' | 'other';

export interface LogLine {
  n: number; // monotonically increasing cursor
  text: string;
  level: LogLevel;
  domain?: string;
}

export interface LuaError {
  n: number;
  resource?: string;
  line?: number;
  message: string;
  traceback: string[];
}

const LEVELS: Record<string, LogLevel> = {
  DEBUG: 'debug',
  INFO: 'info',
  WARNING: 'warning',
  ERROR: 'error',
  FATAL: 'fatal',
  USER_DEBUG: 'debug',
};

export function classifyLine(text: string): { level: LogLevel; domain?: string } {
  const m = /^(DEBUG|INFO|WARNING|ERROR|FATAL|USER_DEBUG):([A-Z0-9_]+):/.exec(text);
  if (m) return { level: LEVELS[m[1]!] ?? 'other', domain: m[2] };
  return { level: 'other' };
}

export class LogBuffer {
  private lines: LogLine[] = [];
  private next = 1;
  private pending = '';

  constructor(private readonly capacity = 20_000) {}

  /** Append raw output (may contain partial lines). */
  append(chunk: string): void {
    this.pending += chunk;
    const parts = this.pending.split(/\r?\n/);
    this.pending = parts.pop() ?? '';
    for (const p of parts) this.push(p);
  }

  /** Append complete lines (e.g. from the editor console). */
  appendLines(lines: string[]): void {
    for (const l of lines) this.push(l);
  }

  flush(): void {
    if (this.pending) {
      this.push(this.pending);
      this.pending = '';
    }
  }

  private push(text: string): void {
    const { level, domain } = classifyLine(text);
    // Continuation lines (tracebacks) inherit the level of the line they belong to.
    const prev = this.lines[this.lines.length - 1];
    const inherited = level === 'other' && prev && /^(stack traceback:|\s+\S)/.test(text) ? prev.level : level;
    this.lines.push({ n: this.next++, text, level: inherited, domain });
    if (this.lines.length > this.capacity) this.lines.splice(0, this.lines.length - this.capacity);
  }

  get cursor(): number {
    return this.next - 1;
  }

  query(options: { after?: number; level?: 'all' | 'warning' | 'error'; grep?: string; max?: number }): { lines: LogLine[]; truncated: boolean } {
    const after = options.after ?? 0;
    let filtered = this.lines.filter((l) => l.n > after);
    if (options.level === 'error') filtered = filtered.filter((l) => l.level === 'error' || l.level === 'fatal');
    else if (options.level === 'warning') filtered = filtered.filter((l) => l.level === 'warning' || l.level === 'error' || l.level === 'fatal');
    if (options.grep) {
      const re = toRegex(options.grep);
      filtered = filtered.filter((l) => re.test(l.text));
    }
    const max = options.max ?? 150;
    const truncated = filtered.length > max;
    // Keep the most recent lines when truncating.
    return { lines: truncated ? filtered.slice(filtered.length - max) : filtered, truncated };
  }

  /** Lua runtime errors ("ERROR:SCRIPT: main/x.script:4: msg" + "stack traceback:" block). */
  luaErrors(after = 0): LuaError[] {
    const out: LuaError[] = [];
    for (let i = 0; i < this.lines.length; i++) {
      const l = this.lines[i]!;
      if (l.n <= after || l.domain !== 'SCRIPT' || (l.level !== 'error' && l.level !== 'fatal')) continue;
      const body = l.text.replace(/^(ERROR|FATAL):SCRIPT:\s*/, '');
      const m = /^(\/?[^\s:]+\.(?:script|gui_script|render_script|lua)):(\d+):\s*(.*)$/.exec(body);
      const err: LuaError = m
        ? { n: l.n, resource: m[1]!.startsWith('/') ? m[1] : `/${m[1]}`, line: Number(m[2]), message: m[3]!, traceback: [] }
        : { n: l.n, message: body, traceback: [] };
      for (let j = i + 1; j < this.lines.length; j++) {
        const t = this.lines[j]!.text;
        if (t.startsWith('stack traceback:')) continue;
        if (/^\s+\S/.test(t)) err.traceback.push(t.trim());
        else break;
      }
      out.push(err);
    }
    return out;
  }

  clear(): void {
    this.lines = [];
    this.pending = '';
  }
}

function toRegex(grep: string): RegExp {
  const m = /^\/(.*)\/([a-z]*)$/.exec(grep);
  if (m) {
    try {
      return new RegExp(m[1]!, m[2]!.includes('i') ? m[2] : m[2] + 'i');
    } catch {
      // fall through to literal
    }
  }
  return new RegExp(grep.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i');
}

/** Engine noise that rarely matters when reporting a start/reload to the model. */
export function isNoise(text: string): boolean {
  return /^INFO:(SOUND|DLIB|PROFILER|GRAPHICS):|Target listening with name|^INFO:SOUND:\s/.test(text);
}

export function formatLuaError(e: LuaError): string {
  const loc = e.resource ? `${e.resource}:${e.line}` : '';
  const tb = e.traceback.length ? `\n    ${e.traceback.slice(0, 8).join('\n    ')}` : '';
  return `${loc ? `${loc}: ` : ''}${e.message}${tb}`;
}
