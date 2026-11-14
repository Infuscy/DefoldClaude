// Ring buffer of engine log lines with cursors and level filtering, plus an index of error-level lines grouped by
// location and message. The index is kept apart from the ring, so an error logged once in init stays reported
// after a per-frame error has pushed its line out of the buffer.

export type LogLevel = 'debug' | 'info' | 'warning' | 'error' | 'fatal' | 'other';

export interface LogLine {
  n: number; // monotonically increasing cursor
  text: string;
  level: LogLevel;
  domain?: string;
  /** Continuation of the line before it (traceback, multi-line print); inherits its level. */
  cont?: boolean;
}

/** One distinct error: same level, domain, location and message. */
export interface ErrorGroup {
  level: 'error' | 'fatal';
  domain?: string;
  resource?: string;
  line?: number;
  message: string;
  /** Traceback of the first occurrence. */
  traceback: string[];
  count: number;
  first: number;
  last: number;
}

/** An error group as seen after a cursor. */
export interface ErrorSummary {
  group: ErrorGroup;
  /** Occurrences after the cursor. */
  count: number;
  /** count is a lower bound: the cursor is older than the occurrences still tracked one by one. */
  atLeast: boolean;
  /** First occurrence after the cursor, when known. */
  first?: number;
  last: number;
}

export interface ErrorReport {
  errors: ErrorSummary[];
  /** Distinct errors seen after the cursor that were dropped from the index to bound memory. */
  droppedGroups: number;
}

interface TrackedGroup extends ErrorGroup {
  seq: number;
  /** Cursors of the most recent occurrences, ascending. */
  recent: number[];
  /** Highest cursor dropped from recent (0 = none dropped). */
  evictedThrough: number;
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

const isError = (level: LogLevel) => level === 'error' || level === 'fatal';

/** Split "ERROR:SCRIPT: main/x.script:4: msg" into location and message. */
export function parseErrorLine(text: string): { resource?: string; line?: number; message: string } {
  const body = text.replace(/^[A-Z_]+:[A-Z0-9_]+:\s*/, '');
  const m = /^(\/?[^\s:]+\.(?:script|gui_script|render_script|lua)):(\d+):\s*(.*)$/.exec(body);
  if (!m) return { message: body };
  return { resource: m[1]!.startsWith('/') ? m[1] : `/${m[1]}`, line: Number(m[2]), message: m[3]! };
}

export interface ErrorLimits {
  /** Distinct errors tracked; beyond this the least recently seen are dropped (never the first ones). */
  groups: number;
  /** Occurrence cursors kept per error for counting after a cursor. */
  recent: number;
}

const DEFAULT_LIMITS: ErrorLimits = { groups: 300, recent: 2048 };
const KEEP_FIRST_GROUPS = 20;
const MAX_TRACEBACK = 20;

export class LogBuffer {
  private lines: LogLine[] = [];
  private next = 1;
  private pending = '';
  private groups = new Map<string, TrackedGroup>();
  private groupSeq = 0;
  /** Error group whose first occurrence is the latest head line, to collect its traceback. */
  private openTraceback: TrackedGroup | undefined;
  private dropped = { groups: 0, last: 0 };
  private readonly limits: ErrorLimits;

  constructor(
    private readonly capacity = 20_000,
    limits: Partial<ErrorLimits> = {},
  ) {
    this.limits = { ...DEFAULT_LIMITS, ...limits };
  }

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
    const prev = this.lines[this.lines.length - 1];
    // Continuation lines (tracebacks, multi-line prints) inherit the level of the line they belong to.
    const cont = level === 'other' && !!prev && /^(stack traceback:|\s+\S)/.test(text);
    const line: LogLine = { n: this.next++, text, level: cont ? prev!.level : level, domain };
    if (cont) line.cont = true;
    this.lines.push(line);
    if (this.lines.length > this.capacity) this.lines.splice(0, this.lines.length - this.capacity);

    if (cont) {
      const g = this.openTraceback;
      if (g && !text.startsWith('stack traceback:') && g.traceback.length < MAX_TRACEBACK) g.traceback.push(text.trim());
      return;
    }
    this.openTraceback = isError(line.level) ? this.recordError(line) : undefined;
  }

  /** Count an error line; returns its group when this is the first occurrence. */
  private recordError(line: LogLine): TrackedGroup | undefined {
    const { resource, line: srcLine, message } = parseErrorLine(line.text);
    const key = `${line.level}|${line.domain ?? ''}|${resource ?? ''}:${srcLine ?? ''}|${message}`;
    const known = this.groups.get(key);
    if (known) {
      known.count++;
      known.last = line.n;
      known.recent.push(line.n);
      if (known.recent.length > this.limits.recent) {
        const evicted = known.recent.splice(0, Math.max(1, this.limits.recent >> 2));
        known.evictedThrough = evicted[evicted.length - 1]!;
      }
      return undefined;
    }
    if (this.groups.size >= this.limits.groups) this.dropStaleGroup();
    const g: TrackedGroup = {
      level: line.level as 'error' | 'fatal',
      domain: line.domain,
      resource,
      line: srcLine,
      message,
      traceback: [],
      count: 1,
      first: line.n,
      last: line.n,
      seq: this.groupSeq++,
      recent: [line.n],
      evictedThrough: 0,
    };
    this.groups.set(key, g);
    return g;
  }

  /** Make room for a new distinct error: drop the least recently seen one, keeping the earliest (root causes). */
  private dropStaleGroup(): void {
    let victim: [string, TrackedGroup] | undefined;
    for (const entry of this.groups) {
      if (entry[1].seq < KEEP_FIRST_GROUPS) continue;
      if (!victim || entry[1].last < victim[1].last) victim = entry;
    }
    if (!victim) return;
    this.groups.delete(victim[0]);
    this.dropped.groups++;
    this.dropped.last = Math.max(this.dropped.last, victim[1].last);
  }

  get cursor(): number {
    return this.next - 1;
  }

  query(options: { after?: number; level?: 'all' | 'warning' | 'error'; grep?: string; max?: number }): { lines: LogLine[]; truncated: boolean } {
    const after = options.after ?? 0;
    let filtered = this.lines.filter((l) => l.n > after);
    if (options.level === 'error') filtered = filtered.filter((l) => isError(l.level));
    else if (options.level === 'warning') filtered = filtered.filter((l) => l.level === 'warning' || isError(l.level));
    if (options.grep) {
      const re = toRegex(options.grep);
      filtered = filtered.filter((l) => re.test(l.text));
    }
    const max = options.max ?? 150;
    const truncated = filtered.length > max;
    // Keep the most recent lines when truncating.
    return { lines: truncated ? filtered.slice(filtered.length - max) : filtered, truncated };
  }

  /**
   * Distinct error-level lines (Lua errors and engine errors alike) logged after the cursor, with how often each
   * occurred, in order of first occurrence. Covers lines that have already left the ring buffer.
   */
  errors(after = 0): ErrorReport {
    const out: ErrorSummary[] = [];
    for (const g of this.groups.values()) {
      if (g.last <= after) continue;
      if (after < g.first) {
        out.push({ group: g, count: g.count, atLeast: false, first: g.first, last: g.last });
      } else if (after >= g.evictedThrough) {
        const i = upperBound(g.recent, after);
        out.push({ group: g, count: g.recent.length - i, atLeast: false, first: g.recent[i], last: g.last });
      } else {
        // Some occurrences between the cursor and the oldest tracked one are no longer counted one by one.
        out.push({ group: g, count: g.recent.length + 1, atLeast: true, last: g.last });
      }
    }
    out.sort((a, b) => (a.first ?? after + 1) - (b.first ?? after + 1) || a.group.first - b.group.first);
    return { errors: out, droppedGroups: this.dropped.last > after ? this.dropped.groups : 0 };
  }

  clear(): void {
    this.lines = [];
    this.pending = '';
    this.groups.clear();
    this.openTraceback = undefined;
    this.dropped = { groups: 0, last: 0 };
  }
}

/** Index of the first element greater than value in an ascending array. */
function upperBound(values: number[], value: number): number {
  let lo = 0;
  let hi = values.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (values[mid]! <= value) lo = mid + 1;
    else hi = mid;
  }
  return lo;
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

export interface FormatErrorsOptions {
  /** e.g. "since start" gives "Errors since start (302, 4 distinct):". */
  scope: string;
  /** Text when there are none; omitted gives an empty string. */
  none?: string;
  maxGroups?: number;
  tracebackLines?: number;
}

/** Grouped error summary: one entry per distinct error with its count and the log line it was first seen on. */
export function formatErrors({ errors, droppedGroups }: ErrorReport, options: FormatErrorsOptions): string {
  if (!errors.length) return options.none ?? '';
  const total = errors.reduce((n, e) => n + e.count, 0);
  const atLeast = errors.some((e) => e.atLeast) ? '+' : '';
  const counts = total === errors.length && !atLeast ? `${total}` : `${total}${atLeast}, ${errors.length} distinct`;
  const max = options.maxGroups ?? 10;
  const tbLines = options.tracebackLines ?? 8;
  const entries = errors.slice(0, max).map((e) => {
    const g = e.group;
    const where = g.resource ? `${g.resource}:${g.line}: ` : g.domain && g.domain !== 'SCRIPT' ? `${g.domain}: ` : '';
    const level = g.level === 'fatal' ? 'FATAL ' : '';
    const seen =
      e.count > 1 || e.atLeast
        ? `${e.count}${e.atLeast ? '+' : ''}×, ${e.first !== undefined ? `first at log line ${e.first}` : `last at log line ${e.last}`}`
        : `log line ${e.first}`;
    const tb = g.traceback.length ? `\n    ${g.traceback.slice(0, tbLines).join('\n    ')}` : '';
    return `- ${level}${where}${g.message}  [${seen}]${tb}`;
  });
  if (errors.length > max) entries.push(`- … ${errors.length - max} more distinct error(s); logs level=error shows them`);
  if (droppedGroups) entries.push(`- (more distinct errors than can be tracked: ${droppedGroups} rarely seen one(s) were dropped; logs level=error may still show them)`);
  return `Errors ${options.scope} (${counts}):\n${entries.join('\n')}`;
}

export interface CompactLine {
  /** Cursor of the (first) line this entry stands for. */
  n: number;
  text: string;
}

/**
 * Fold repeats for display: an error block (error line plus its traceback) seen earlier in the range is dropped and
 * counted on its first appearance; identical consecutive lines collapse into one. tracebacks=false also leaves out
 * the traceback lines of errors (for reports that list them in an error summary).
 */
export function compactLog(lines: LogLine[], options: { tracebacks?: boolean } = {}): CompactLine[] {
  const withTracebacks = options.tracebacks ?? true;
  interface Block {
    lines: LogLine[];
    key: string;
    error: boolean;
    repeats: number;
    last: number;
  }
  const blocks: Block[] = [];
  let prev: LogLine | undefined;
  for (const l of lines) {
    const cur = blocks[blocks.length - 1];
    // The engine ends a traceback with an empty line; keep it with its error so it folds along with it.
    const endsTraceback = l.text === '' && !!cur?.error && !!prev?.cont;
    if (cur && (l.cont || endsTraceback)) cur.lines.push(l);
    else blocks.push({ lines: [l], key: '', error: isError(l.level) && !l.cont, repeats: 0, last: l.n });
    prev = l;
  }
  const kept: Block[] = [];
  const seenErrors = new Map<string, Block>();
  for (const b of blocks) {
    b.key = b.error && !withTracebacks ? b.lines[0]!.text : b.lines.map((l) => l.text).join('\n');
    const earlier = b.error ? seenErrors.get(b.key) : kept[kept.length - 1];
    if (earlier && (b.error || (!earlier.error && earlier.key === b.key))) {
      earlier.repeats++;
      earlier.last = b.lines[0]!.n;
      continue;
    }
    if (b.error) seenErrors.set(b.key, b);
    kept.push(b);
  }
  const out: CompactLine[] = [];
  for (const b of kept) {
    const [head, ...rest] = b.lines;
    const times = b.repeats + 1;
    const note = !b.repeats ? '' : b.error ? `  [×${times} in this range, last at log line ${b.last}]` : `  [×${times}]`;
    out.push({ n: head!.n, text: head!.text + note });
    if (!b.error || withTracebacks) for (const l of rest) out.push({ n: l.n, text: l.text });
  }
  return out;
}

/** Keep the first `head` and last `tail` entries, with a note in between saying how to read the rest. */
export function headTail(entries: CompactLine[], head: number, tail: number): string[] {
  if (entries.length <= head + tail + 1) return entries.map((e) => e.text);
  const omitted = entries.length - head - tail;
  return [
    ...entries.slice(0, head).map((e) => e.text),
    `… ${omitted} more line(s) omitted (logs cursor=${entries[head]!.n - 1} continues from here) …`,
    ...entries.slice(entries.length - tail).map((e) => e.text),
  ];
}
