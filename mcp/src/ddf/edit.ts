// Text-preserving edits of Defold protobuf-text documents addressed by selector paths.
// Untouched text is kept byte-for-byte; only changed nodes are (re)printed in editor style.
import {
  embeddedTypeFor,
  EncodeError,
  encodeEmbeddedLiteral,
  formatScalar,
  isEmbeddedDataField,
  messageToJson,
  printBody,
  printField,
  unknownFieldMessage,
  type Json,
  type JsonObject,
} from './codec.js';
import { fieldRank, fieldSchema, messageSchema, type FieldSchema } from './schema.js';
import { parseTextFormat, type FieldNode, type MessageValue } from './textformat.js';

export type EditOp = { op: 'set'; path: string; value: unknown } | { op: 'insert'; path: string; value: unknown; index?: number } | { op: 'remove'; path: string };

export interface Segment {
  name: string;
  filter?: { key?: string; value?: string; index?: number; all?: boolean };
}

export class SelectorError extends Error {}

/** `/embedded_instances[id=go]/data/embedded_components[id=sprite]/position/x` → segments. */
export function parseSelector(selector: string): Segment[] {
  const s = selector.trim().replace(/^\/+/, '').replace(/\/+$/, '');
  if (!s) return [];
  const segs: Segment[] = [];
  const re = /([A-Za-z_][A-Za-z0-9_]*)(?:\[([^\]]*)\])?(?:\/|$)/y;
  let pos = 0;
  while (pos < s.length) {
    re.lastIndex = pos;
    const m = re.exec(s);
    if (!m) throw new SelectorError(`Invalid selector near "${s.slice(pos)}" (expected name or name[key=value])`);
    const seg: Segment = { name: m[1]! };
    const f = m[2];
    if (f !== undefined) {
      const t = f.trim();
      if (t === '*') seg.filter = { all: true };
      else if (/^-?\d+$/.test(t)) seg.filter = { index: Number(t) };
      else {
        const eq = t.indexOf('=');
        if (eq >= 0) seg.filter = { key: t.slice(0, eq).trim(), value: unquote(t.slice(eq + 1).trim()) };
        else seg.filter = { value: unquote(t) };
      }
    }
    segs.push(seg);
    pos = re.lastIndex;
  }
  return segs;
}

function unquote(v: string): string {
  return /^(["']).*\1$/.test(v) ? v.slice(1, -1) : v;
}

interface Splice {
  start: number;
  end: number;
  text: string;
}

function applySplices(text: string, splices: Splice[]): string {
  const sorted = [...splices].sort((a, b) => b.start - a.start);
  let out = text;
  for (const s of sorted) out = out.slice(0, s.start) + s.text + out.slice(s.end);
  return out;
}

/** Apply edit operations to a document. `docLevel` is 0 for files, ≥ 1 for embedded documents. */
export function applyEdits(text: string, messageType: string | undefined, ops: EditOp[], docLevel = 0): string {
  let current = text;
  for (const op of ops) {
    const segs = parseSelector(op.path);
    if (!segs.length) {
      if (op.op === 'set' && isPlainObject(op.value)) {
        current = printBody(op.value as JsonObject, messageType, '', { docLevel });
        continue;
      }
      throw new SelectorError('The path must name a field (use "/" only with op=set and an object to replace the whole document).');
    }
    current = editDocument(current, messageType, segs, op, docLevel);
  }
  return current;
}

/** Thrown when a set/insert path runs through a singular field that does not exist yet; carries the splice that adds it empty. */
class MissingParent {
  constructor(readonly splice: Splice) {}
}

function editDocument(text: string, messageType: string | undefined, segs: Segment[], op: EditOp, docLevel: number): string {
  let current = text;
  for (let created = 0; ; created++) {
    const { root } = parseTextFormat(current);
    try {
      return applySplices(current, editMessage(current, root, messageType, segs, op, docLevel, '', true));
    } catch (e) {
      if (!(e instanceof MissingParent)) throw e;
      if (created >= segs.length) throw new SelectorError(`Could not create the missing fields along "${op.path}".`);
      current = applySplices(current, [e.splice]);
    }
  }
}

function matchOccurrences(occ: FieldNode[], seg: Segment): FieldNode[] {
  const f = seg.filter;
  if (!f) return occ;
  if (f.all) return occ;
  if (f.index !== undefined) {
    const i = f.index < 0 ? occ.length + f.index : f.index;
    return occ[i] ? [occ[i]!] : [];
  }
  const keys = f.key ? [f.key] : ['id', 'name', 'key', 'image', 'input'];
  return occ.filter((o) => {
    if (o.value.kind === 'scalar') return !f.key && o.value.text === f.value;
    if (o.value.kind !== 'message') return false;
    return keys.some((k) => {
      const c = o.value.kind === 'message' ? o.value.fields.find((x) => x.name === k) : undefined;
      return c?.value.kind === 'scalar' && c.value.text === f.value;
    });
  });
}

function describeOccurrences(occ: FieldNode[]): string {
  const ids = occ
    .map((o) => (o.value.kind === 'message' ? o.value.fields.find((x) => ['id', 'name', 'key'].includes(x.name)) : undefined))
    .map((x) => (x && x.value.kind === 'scalar' ? x.value.text : undefined))
    .filter(Boolean);
  return ids.length ? ` Existing: ${ids.join(', ')}` : occ.length ? ` (${occ.length} entries; select one with [index])` : ' (none exist)';
}

function editMessage(
  text: string,
  msg: MessageValue,
  messageType: string | undefined,
  segs: Segment[],
  op: EditOp,
  docLevel: number,
  indent: string,
  isRoot: boolean,
): Splice[] {
  const [seg, ...rest] = segs;
  const fs = messageType ? fieldSchema(messageType, seg!.name) : undefined;
  if (messageType && messageSchema(messageType) && !fs) throw new SelectorError(unknownFieldMessage(messageType, seg!.name));
  const occurrences = msg.fields.filter((f) => f.name === seg!.name);
  const matched = matchOccurrences(occurrences, seg!);

  // Descend into a nested message or an embedded document.
  if (rest.length) {
    // A path through an absent singular field (embedded `data`, `position`, …) creates it empty, then continues.
    if (!occurrences.length && !seg!.filter && op.op !== 'remove' && fs && fs.label !== 'repeated' && (fs.kind === 'message' || isEmbeddedDataField(messageType, seg!.name))) {
      const fieldIndent = isRoot ? '' : indent;
      const empty = fs.kind === 'message' ? `${fieldIndent}${seg!.name} {\n${fieldIndent}}\n` : `${fieldIndent}${seg!.name}: ""\n`;
      throw new MissingParent(insertOrdered(text, msg, messageType, fs, empty, isRoot));
    }
    if (!matched.length) {
      throw new SelectorError(`Nothing matches "${seg!.name}${seg!.filter ? `[${seg!.filter.key ?? ''}${seg!.filter.key ? '=' : ''}${seg!.filter.value ?? seg!.filter.index ?? '*'}]` : ''}".${describeOccurrences(occurrences)}`);
    }
    if (matched.length > 1) throw new SelectorError(`"${seg!.name}" matches ${matched.length} entries; add a filter like [id=…] or [0].`);
    const target = matched[0]!;
    if (isEmbeddedDataField(messageType, seg!.name) && target.value.kind === 'scalar') {
      const innerType = embeddedTypeFor(messageType, seg!.name, msg);
      const innerText = target.value.text;
      const newInner = editDocument(innerText, innerType, rest, op, docLevel + 1);
      return [{ start: target.value.start, end: target.value.end, text: encodeEmbeddedLiteral(newInner, docLevel) }];
    }
    if (target.value.kind !== 'message') throw new SelectorError(`"${seg!.name}" is not a message; cannot select "${rest[0]!.name}" inside it.`);
    const childType = fs?.kind === 'message' ? fs.type : undefined;
    const childIndent = indentOf(text, target.start) + '  ';
    if (isInline(text, target)) {
      // Small inline messages (`position { x: 1 }`): reprint the whole field after editing its JSON.
      return reprintFieldWithEdit(text, msg, messageType, target, rest, op, docLevel);
    }
    return editMessage(text, target.value, childType, rest, op, docLevel, childIndent, false);
  }

  // Last segment: the operation applies here.
  const fieldIndent = isRoot ? '' : indent;
  switch (op.op) {
    case 'remove': {
      if (!matched.length) throw new SelectorError(`Nothing to remove at "${op.path}".${describeOccurrences(occurrences)}`);
      if (fs?.label === 'repeated' && !seg!.filter && occurrences.length > 1) {
        throw new SelectorError(`"${seg!.name}" has ${occurrences.length} entries; remove one with a filter ([id=…] or [index]) or all with [*].`);
      }
      return matched.map((f) => removalSplice(text, f));
    }
    case 'insert': {
      if (fs && fs.label !== 'repeated') throw new SelectorError(`"${seg!.name}" is not a repeated field; use op=set.`);
      if (seg!.filter) throw new SelectorError('insert targets the repeated field itself, e.g. /embedded_instances (use index to position it).');
      const printed = printNew(seg!.name, op.value as Json, fs, fieldIndent, docLevel, messageType);
      const idx = op.index;
      if (occurrences.length) {
        if (idx !== undefined && idx < occurrences.length) return [{ start: lineStart(text, occurrences[idx]!.start), end: lineStart(text, occurrences[idx]!.start), text: printed }];
        const last = occurrences[occurrences.length - 1]!;
        const at = lineEndIncl(text, last.end);
        return [{ start: at, end: at, text: ensureNewlineBefore(text, at) + printed }];
      }
      return [insertOrdered(text, msg, messageType, fs, printed, isRoot)];
    }
    case 'set': {
      const value = op.value as Json;
      if (fs?.label === 'repeated' && !seg!.filter) {
        if (!Array.isArray(value)) throw new SelectorError(`"${seg!.name}" is repeated; give a list to replace all entries, or select one entry ([id=…]/[index]), or use op=insert.`);
        const printed = value.map((v) => printNew(seg!.name, v, fs, fieldIndent, docLevel, messageType)).join('');
        if (!occurrences.length) return [insertOrdered(text, msg, messageType, fs, printed, isRoot)];
        const first = occurrences[0]!;
        const splices = occurrences.slice(1).map((f) => removalSplice(text, f));
        splices.push({ start: lineStart(text, first.start), end: lineEndIncl(text, first.end), text: printed });
        return splices;
      }
      if (seg!.filter && !matched.length) {
        throw new SelectorError(`Nothing matches "${seg!.name}[…]" to set.${describeOccurrences(occurrences)} Use op=insert to add one.`);
      }
      if (matched.length > 1) throw new SelectorError(`"${seg!.name}" matches ${matched.length} entries; select one.`);
      const existing = matched[0];
      if (!existing) {
        const printed = printNew(seg!.name, value, fs, fieldIndent, docLevel, messageType);
        return [insertOrdered(text, msg, messageType, fs, printed, isRoot)];
      }
      // Replace the value of an existing field.
      if (isEmbeddedDataField(messageType, seg!.name) && isPlainObject(value)) {
        const innerType = embeddedTypeFor(messageType, seg!.name, msg);
        const inner = printBody(value as JsonObject, innerType, '', { docLevel: docLevel + 1 });
        return [{ start: existing.value.start, end: existing.value.end, text: encodeEmbeddedLiteral(inner, docLevel) }];
      }
      if (existing.value.kind === 'scalar' && !isPlainObject(value)) {
        return [{ start: existing.value.start, end: existing.value.end, text: formatScalar(value, fs, seg!.name) }];
      }
      const printed = printNew(seg!.name, value, fs, indentOf(text, existing.start), docLevel, messageType);
      return [{ start: lineStart(text, existing.start), end: lineEndIncl(text, existing.end), text: printed }];
    }
  }
}

/** Edit inside a message written on one line by converting it to JSON, editing, and reprinting the field. */
function reprintFieldWithEdit(
  text: string,
  parent: MessageValue,
  parentType: string | undefined,
  field: FieldNode,
  rest: Segment[],
  op: EditOp,
  docLevel: number,
): Splice[] {
  const fs = parentType ? fieldSchema(parentType, field.name) : undefined;
  const childType = fs?.kind === 'message' ? fs.type : undefined;
  const fieldText = text.slice(field.value.start, field.value.end); // "{ x: 1 }"
  const inner = fieldText.replace(/^[{<]/, '').replace(/[}>]$/, '');
  const edited = editDocument(inner.replace(/^\s+/, '').replace(/\s+$/, '') + '\n', childType, rest, op, docLevel);
  const json = messageToJson(parseTextFormat(edited).root, childType);
  const indent = indentOf(text, field.start);
  const printed = printField(field.name, json, fs, indent, { docLevel }, {}, parentType);
  return [{ start: lineStart(text, field.start), end: lineEndIncl(text, field.end), text: printed }];
}

function printNew(name: string, value: Json, fs: FieldSchema | undefined, indent: string, docLevel: number, parentType: string | undefined): string {
  if (value === undefined) throw new EncodeError(`Missing "value" for ${name}.`);
  // Embedded component objects need their own `type` to encode `data`; printField handles that via the parent object.
  if (isPlainObject(value) && fs?.kind === 'message') {
    const body = printBody(value as JsonObject, fs.type, indent + '  ', { docLevel });
    return `${indent}${name} {\n${body}${indent}}\n`;
  }
  return printField(name, value, fs, indent, { docLevel }, {}, parentType);
}

function insertOrdered(text: string, msg: MessageValue, messageType: string | undefined, fs: FieldSchema | undefined, printed: string, isRoot: boolean): Splice {
  // Before the first existing field with a higher field number; otherwise at the end of the message.
  if (fs && messageType) {
    const rank = fieldRank(messageType);
    const mine = rank.get(fs.name) ?? Infinity;
    const next = msg.fields.find((f) => (rank.get(f.name) ?? Infinity) > mine);
    if (next) {
      const at = lineStart(text, next.start);
      return { start: at, end: at, text: printed };
    }
  }
  if (isRoot) {
    const at = text.length;
    return { start: at, end: at, text: (text.length && !text.endsWith('\n') ? '\n' : '') + printed };
  }
  // Before the closing brace of this message.
  const close = msg.end - 1;
  const at = lineStart(text, close);
  if (text.slice(at, close).trim() !== '') {
    // The brace shares a line with content; put the field on its own line.
    return { start: close, end: close, text: '\n' + printed + indentOf(text, close) };
  }
  return { start: at, end: at, text: printed };
}

function removalSplice(text: string, f: FieldNode): Splice {
  const ls = lineStart(text, f.start);
  const le = lineEndIncl(text, f.end);
  const before = text.slice(ls, f.start);
  const after = text.slice(f.end, le).replace(/\r?\n$/, '');
  if (before.trim() === '' && after.trim() === '') return { start: ls, end: le, text: '' };
  // Field shares its line with other content: remove only the field and one separating space.
  let end = f.end;
  while (text[end] === ' ') end++;
  return { start: f.start, end, text: '' };
}

function isInline(text: string, f: FieldNode): boolean {
  if (f.value.kind !== 'message') return false;
  return !text.slice(f.value.start, f.value.end).includes('\n');
}

export function lineStart(text: string, pos: number): number {
  const i = text.lastIndexOf('\n', pos - 1);
  return i + 1;
}

export function lineEndIncl(text: string, pos: number): number {
  const i = text.indexOf('\n', pos);
  return i < 0 ? text.length : i + 1;
}

function indentOf(text: string, pos: number): string {
  const ls = lineStart(text, pos);
  const m = /^[ \t]*/.exec(text.slice(ls, pos));
  return m ? m[0] : '';
}

function ensureNewlineBefore(text: string, at: number): string {
  return at > 0 && text[at - 1] !== '\n' ? '\n' : '';
}

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return v !== null && typeof v === 'object' && !Array.isArray(v);
}

/** Resolve a selector to JSON (for read_resource select=…). */
export function selectJson(text: string, messageType: string | undefined, selector: string): Json {
  const segs = parseSelector(selector);
  let curText = text;
  let curType = messageType;
  let msg = parseTextFormat(curText).root;
  let result: Json = messageToJson(msg, curType);
  for (let i = 0; i < segs.length; i++) {
    const seg = segs[i]!;
    const fs = curType ? fieldSchema(curType, seg.name) : undefined;
    if (curType && messageSchema(curType) && !fs) throw new SelectorError(unknownFieldMessage(curType, seg.name));
    const occ = msg.fields.filter((f) => f.name === seg.name);
    const matched = matchOccurrences(occ, seg);
    if (!matched.length) throw new SelectorError(`Nothing matches "${seg.name}".${describeOccurrences(occ)}`);
    const last = i === segs.length - 1;
    if (last) {
      const jsonParent = messageToJson({ ...msg, fields: matched }, curType);
      const v = jsonParent[seg.name];
      return Array.isArray(v) && (seg.filter && !seg.filter.all) ? (v[0] as Json) : (v as Json);
    }
    if (matched.length > 1) throw new SelectorError(`"${seg.name}" matches ${matched.length} entries; select one.`);
    const target = matched[0]!;
    if (isEmbeddedDataField(curType, seg.name) && target.value.kind === 'scalar') {
      const innerType = embeddedTypeFor(curType, seg.name, msg);
      curText = target.value.text;
      curType = innerType;
      msg = parseTextFormat(curText).root;
      result = messageToJson(msg, curType);
      continue;
    }
    if (target.value.kind !== 'message') throw new SelectorError(`"${seg.name}" is not a message.`);
    msg = target.value;
    curType = fs?.kind === 'message' ? fs.type : undefined;
  }
  return result;
}
