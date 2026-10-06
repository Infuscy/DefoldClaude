// Protobuf text format (as written by the Defold editor) — tokenizer, parser and escaping helpers.
// The parser records source offsets for every field and value so that edits can splice the original text
// and leave untouched content byte-for-byte identical.

export class TextFormatError extends Error {
  constructor(
    message: string,
    readonly line: number,
    readonly column: number,
  ) {
    super(`${line}:${column}: ${message}`);
  }
}

export type ScalarKind = 'string' | 'number' | 'ident';

export interface ScalarValue {
  kind: 'scalar';
  type: ScalarKind;
  /** Decoded value: for strings the UTF-8 decoded text; for numbers/idents the token text. */
  text: string;
  /** Source span covering the whole value (all adjacent string segments). */
  start: number;
  end: number;
}

export interface ListValue {
  kind: 'list';
  items: ScalarValue[];
  start: number;
  end: number;
}

export interface MessageValue {
  kind: 'message';
  fields: FieldNode[];
  /** Offset of `{` (or `<`) and just after `}` (or `>`). For the root message: 0 and text length. */
  start: number;
  end: number;
}

export type Value = ScalarValue | ListValue | MessageValue;

export interface FieldNode {
  name: string;
  value: Value;
  /** Span of the whole field (name … value end), and of the line(s) it occupies including indentation. */
  start: number;
  end: number;
  line: number;
  column: number;
}

export interface ParsedText {
  text: string;
  root: MessageValue;
}

interface Token {
  type: 'ident' | 'number' | 'string' | 'punct' | 'eof';
  text: string; // raw text (string: raw literal including quotes)
  start: number;
  end: number;
}

export function parseTextFormat(text: string): ParsedText {
  const p = new Parser(text);
  const root = p.parseMessageBody(0, null);
  return { text, root: { ...root, start: 0, end: text.length } };
}

class Parser {
  private pos = 0;
  private peeked: Token | null = null;
  private lineStarts: number[] = [0];

  constructor(private readonly text: string) {
    for (let i = 0; i < text.length; i++) if (text.charCodeAt(i) === 10) this.lineStarts.push(i + 1);
  }

  lineCol(offset: number): { line: number; column: number } {
    let lo = 0;
    let hi = this.lineStarts.length - 1;
    while (lo < hi) {
      const mid = (lo + hi + 1) >> 1;
      if (this.lineStarts[mid]! <= offset) lo = mid;
      else hi = mid - 1;
    }
    return { line: lo + 1, column: offset - this.lineStarts[lo]! + 1 };
  }

  private error(message: string, offset: number): never {
    const { line, column } = this.lineCol(offset);
    throw new TextFormatError(message, line, column);
  }

  private skipTrivia(): void {
    const t = this.text;
    while (this.pos < t.length) {
      const c = t.charCodeAt(this.pos);
      if (c === 32 || c === 9 || c === 10 || c === 13 || c === 12 || c === 11) {
        this.pos++;
      } else if (c === 35 /* # */) {
        while (this.pos < t.length && t.charCodeAt(this.pos) !== 10) this.pos++;
      } else break;
    }
  }

  private next(): Token {
    if (this.peeked) {
      const t = this.peeked;
      this.peeked = null;
      return t;
    }
    this.skipTrivia();
    const t = this.text;
    const start = this.pos;
    if (this.pos >= t.length) return { type: 'eof', text: '', start, end: start };
    const c = t[this.pos]!;
    if ('{}<>[]:,;'.includes(c)) {
      this.pos++;
      return { type: 'punct', text: c, start, end: this.pos };
    }
    if (c === '"' || c === "'") {
      this.pos++;
      while (this.pos < t.length) {
        const ch = t[this.pos]!;
        if (ch === '\\') this.pos += 2;
        else if (ch === c) {
          this.pos++;
          return { type: 'string', text: t.slice(start, this.pos), start, end: this.pos };
        } else if (ch === '\n') this.error('Unterminated string literal', start);
        else this.pos++;
      }
      this.error('Unterminated string literal', start);
    }
    if (/[A-Za-z_]/.test(c)) {
      while (this.pos < t.length && /[A-Za-z0-9_.]/.test(t[this.pos]!)) this.pos++;
      return { type: 'ident', text: t.slice(start, this.pos), start, end: this.pos };
    }
    if (/[-+0-9.]/.test(c)) {
      const m = /^[-+]?(?:0[xX][0-9a-fA-F]+|(?:\d+\.?\d*|\.\d+)(?:[eE][-+]?\d+)?[fF]?|inf(?:inity)?|nan)/i.exec(t.slice(this.pos, this.pos + 64));
      if (!m || !m[0] || m[0] === '-' || m[0] === '+') this.error(`Unexpected character '${c}'`, start);
      this.pos += m[0].length;
      return { type: 'number', text: m[0], start, end: this.pos };
    }
    this.error(`Unexpected character '${c}'`, start);
  }

  private peek(): Token {
    if (!this.peeked) this.peeked = this.next();
    return this.peeked;
  }

  parseMessageBody(start: number, close: '}' | '>' | null): MessageValue {
    const fields: FieldNode[] = [];
    for (;;) {
      const tok = this.peek();
      if (tok.type === 'eof') {
        if (close) this.error(`Missing '${close}'`, start);
        return { kind: 'message', fields, start, end: tok.start };
      }
      if (tok.type === 'punct' && (tok.text === '}' || tok.text === '>')) {
        if (!close) this.error(`Unexpected '${tok.text}'`, tok.start);
        if (tok.text !== close) this.error(`Expected '${close}' but found '${tok.text}'`, tok.start);
        this.next();
        return { kind: 'message', fields, start, end: tok.end };
      }
      if (tok.type === 'punct' && (tok.text === ',' || tok.text === ';')) {
        this.next();
        continue;
      }
      fields.push(this.parseField());
    }
  }

  private parseField(): FieldNode {
    const nameTok = this.next();
    if (nameTok.type !== 'ident') {
      this.error(nameTok.type === 'eof' ? 'Unexpected end of file' : `Expected a field name but found '${nameTok.text}'`, nameTok.start);
    }
    // Extension/Any field names in [..] are not used by Defold files; plain identifiers only.
    const { line, column } = this.lineCol(nameTok.start);
    let tok = this.peek();
    let hadColon = false;
    if (tok.type === 'punct' && tok.text === ':') {
      this.next();
      hadColon = true;
      tok = this.peek();
    }
    let value: Value;
    if (tok.type === 'punct' && (tok.text === '{' || tok.text === '<')) {
      this.next();
      value = this.parseMessageBody(tok.start, tok.text === '{' ? '}' : '>');
    } else if (tok.type === 'punct' && tok.text === '[') {
      value = this.parseList();
    } else {
      if (!hadColon) this.error(`Expected ':' or '{' after field '${nameTok.text}'`, tok.start);
      value = this.parseScalar();
    }
    return { name: nameTok.text, value, start: nameTok.start, end: value.end, line, column };
  }

  private parseList(): ListValue {
    const open = this.next();
    const items: ScalarValue[] = [];
    for (;;) {
      const tok = this.peek();
      if (tok.type === 'punct' && tok.text === ']') {
        this.next();
        return { kind: 'list', items, start: open.start, end: tok.end };
      }
      if (tok.type === 'punct' && tok.text === ',') {
        this.next();
        continue;
      }
      if (tok.type === 'eof') this.error("Missing ']'", open.start);
      items.push(this.parseScalar());
    }
  }

  private parseScalar(): ScalarValue {
    const tok = this.next();
    if (tok.type === 'string') {
      let raw = decodeStringLiteral(tok.text, (msg, off) => this.error(msg, tok.start + off));
      let end = tok.end;
      // Adjacent string literals are concatenated (the editor splits long strings after every \n).
      while (this.peek().type === 'string') {
        const more = this.next();
        raw = concatBytes(raw, decodeStringLiteral(more.text, (msg, off) => this.error(msg, more.start + off)));
        end = more.end;
      }
      return { kind: 'scalar', type: 'string', text: utf8Decode(raw), start: tok.start, end };
    }
    if (tok.type === 'number') return { kind: 'scalar', type: 'number', text: tok.text, start: tok.start, end: tok.end };
    if (tok.type === 'ident') return { kind: 'scalar', type: 'ident', text: tok.text, start: tok.start, end: tok.end };
    if (tok.type === 'eof') this.error('Unexpected end of file, expected a value', tok.start);
    this.error(`Expected a value but found '${tok.text}'`, tok.start);
  }
}

function concatBytes(a: Uint8Array, b: Uint8Array): Uint8Array {
  const out = new Uint8Array(a.length + b.length);
  out.set(a, 0);
  out.set(b, a.length);
  return out;
}

const utf8 = new TextDecoder('utf-8', { fatal: false });
function utf8Decode(bytes: Uint8Array): string {
  return utf8.decode(bytes);
}

/** Decode one quoted literal (with quotes) into raw bytes, handling C-style and octal/hex escapes. */
export function decodeStringLiteral(literal: string, onError: (message: string, offset: number) => never): Uint8Array {
  const out: number[] = [];
  const body = literal.slice(1, -1);
  for (let i = 0; i < body.length; i++) {
    const ch = body[i]!;
    if (ch !== '\\') {
      const code = body.codePointAt(i)!;
      if (code < 0x80) out.push(code);
      else {
        const bytes = Buffer.from(String.fromCodePoint(code), 'utf8');
        for (const b of bytes) out.push(b);
        if (code > 0xffff) i++;
      }
      continue;
    }
    const e = body[++i];
    switch (e) {
      case 'a': out.push(7); break;
      case 'b': out.push(8); break;
      case 'f': out.push(12); break;
      case 'n': out.push(10); break;
      case 'r': out.push(13); break;
      case 't': out.push(9); break;
      case 'v': out.push(11); break;
      case '\\': out.push(92); break;
      case "'": out.push(39); break;
      case '"': out.push(34); break;
      case '?': out.push(63); break;
      case 'x':
      case 'X': {
        const m = /^[0-9a-fA-F]{1,2}/.exec(body.slice(i + 1));
        if (!m) onError('Invalid \\x escape', i + 1);
        out.push(parseInt(m[0], 16));
        i += m[0].length;
        break;
      }
      case 'u':
      case 'U': {
        const len = e === 'u' ? 4 : 8;
        const hex = body.slice(i + 1, i + 1 + len);
        if (!/^[0-9a-fA-F]+$/.test(hex) || hex.length !== len) onError(`Invalid \\${e} escape`, i + 1);
        for (const b of Buffer.from(String.fromCodePoint(parseInt(hex, 16)), 'utf8')) out.push(b);
        i += len;
        break;
      }
      default: {
        const m = /^[0-7]{1,3}/.exec(body.slice(i));
        if (!m) onError(`Invalid escape sequence \\${e ?? ''}`, i);
        out.push(parseInt(m[0], 8) & 0xff);
        i += m[0].length - 1;
      }
    }
  }
  return Uint8Array.from(out);
}

/** Escape text exactly like Java protobuf TextFormat.escapeBytes (UTF-8 bytes; non-printable/non-ASCII as octal). */
export function escapeJavaTextFormat(value: string): string {
  const bytes = Buffer.from(value, 'utf8');
  let out = '';
  for (const b of bytes) {
    switch (b) {
      case 7: out += '\\a'; break;
      case 8: out += '\\b'; break;
      case 12: out += '\\f'; break;
      case 10: out += '\\n'; break;
      case 13: out += '\\r'; break;
      case 9: out += '\\t'; break;
      case 11: out += '\\v'; break;
      case 92: out += '\\\\'; break;
      case 39: out += "\\'"; break;
      case 34: out += '\\"'; break;
      default:
        if (b >= 0x20 && b <= 0x7e) out += String.fromCharCode(b);
        else out += '\\' + ((b >> 6) & 3).toString() + ((b >> 3) & 7).toString() + (b & 7).toString();
    }
  }
  return out;
}

/** The editor's post-pass: split string literals after every escaped newline (continuation indent is 2 spaces). */
export function breakEmbeddedNewlines(printed: string): string {
  return printed.split('\\n').join('\\n"\n  "');
}

// ---------------------------------------------------------------------------------------------
// Schema-less conversion to plain objects (used for .sdoc API docs and quick inspection).

export type Plain = string | number | boolean | PlainObject | Plain[];
export interface PlainObject {
  [key: string]: Plain;
}

/** Convert a parsed message to a plain object. Fields named in `repeated` (or seen twice) become arrays. */
export function toPlain(message: MessageValue, repeated: Set<string> = new Set()): PlainObject {
  const out: PlainObject = {};
  for (const f of message.fields) {
    const v = valueToPlain(f.value, repeated);
    if (f.name in out) {
      const prev = out[f.name]!;
      out[f.name] = Array.isArray(prev) && repeated.has(f.name) ? [...prev, v] : Array.isArray(prev) ? [...prev, v] : [prev, v];
    } else out[f.name] = repeated.has(f.name) ? [v] : v;
  }
  return out;
}

function valueToPlain(v: Value, repeated: Set<string>): Plain {
  if (v.kind === 'message') return toPlain(v, repeated);
  if (v.kind === 'list') return v.items.map((i) => scalarToPlain(i));
  return scalarToPlain(v);
}

function scalarToPlain(v: ScalarValue): Plain {
  if (v.type === 'string') return v.text;
  if (v.type === 'number') {
    const n = Number(v.text.replace(/[fF]$/, ''));
    return Number.isFinite(n) ? n : v.text;
  }
  if (v.text === 'true') return true;
  if (v.text === 'false') return false;
  return v.text;
}
