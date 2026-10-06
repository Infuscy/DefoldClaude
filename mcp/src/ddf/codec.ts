// Schema-aware conversion between Defold protobuf text and JSON, and editor-style printing of new nodes.
import {
  breakEmbeddedNewlines,
  escapeJavaTextFormat,
  parseTextFormat,
  type FieldNode,
  type MessageValue,
  type ScalarValue,
  type Value,
} from './textformat.js';
import { javaFloatToString } from './javanum.js';
import {
  embeddedDataSpec,
  enumSchema,
  fieldRank,
  fieldSchema,
  isFloatType,
  isIntegerType,
  messageForEmbeddedType,
  messageSchema,
  type FieldSchema,
} from './schema.js';

export type Json = string | number | boolean | null | Json[] | { [k: string]: Json };
export type JsonObject = { [k: string]: Json };

export class EncodeError extends Error {}

// ---------------------------------------------------------------------------------------------
// Text → JSON

/** Message type of an embedded `data` field, given its parent message node. */
export function embeddedTypeFor(parentType: string | undefined, fieldName: string, parent: MessageValue | JsonObject): string | undefined {
  if (!parentType) return undefined;
  const spec = embeddedDataSpec(parentType, fieldName);
  if (!spec) return undefined;
  if (spec.message) return spec.message;
  if (spec.byTypeField) {
    let typeValue: string | undefined;
    if ('kind' in parent && parent.kind === 'message') {
      const f = (parent as MessageValue).fields.find((x) => x.name === spec.byTypeField);
      if (f && f.value.kind === 'scalar') typeValue = f.value.text;
    } else {
      const v = (parent as JsonObject)[spec.byTypeField];
      if (typeof v === 'string') typeValue = v;
    }
    return typeValue ? messageForEmbeddedType(typeValue) : undefined;
  }
  return undefined;
}

export function isEmbeddedDataField(parentType: string | undefined, fieldName: string): boolean {
  return !!parentType && !!embeddedDataSpec(parentType, fieldName);
}

/** Convert a parsed message to JSON using the schema (repeated → arrays, enums → names, embedded data decoded). */
export function messageToJson(msg: MessageValue, messageType: string | undefined, decodeEmbedded = true): JsonObject {
  const out: JsonObject = {};
  for (const f of msg.fields) {
    const fs = messageType ? fieldSchema(messageType, f.name) : undefined;
    let v: Json;
    if (decodeEmbedded && isEmbeddedDataField(messageType, f.name) && f.value.kind === 'scalar' && f.value.type === 'string' && embeddedTypeFor(messageType, f.name, msg)) {
      const innerType = embeddedTypeFor(messageType, f.name, msg);
      try {
        const inner = parseTextFormat(f.value.text);
        v = messageToJson(inner.root, innerType, true);
      } catch {
        v = f.value.text; // leave undecodable data as its raw string
      }
    } else {
      v = valueToJson(f.value, fs);
    }
    const repeated = fs ? fs.label === 'repeated' : f.name in out;
    if (repeated) {
      const prev = out[f.name];
      out[f.name] = Array.isArray(prev) ? [...prev, ...(Array.isArray(v) && f.value.kind === 'list' ? v : [v])] : prev !== undefined ? [prev, v] : f.value.kind === 'list' ? v : [v];
    } else {
      out[f.name] = v;
    }
  }
  return out;
}

function valueToJson(v: Value, fs: FieldSchema | undefined): Json {
  if (v.kind === 'message') return messageToJson(v, fs?.kind === 'message' ? fs.type : undefined);
  if (v.kind === 'list') return v.items.map((i) => scalarToJson(i, fs));
  return scalarToJson(v, fs);
}

function scalarToJson(v: ScalarValue, fs: FieldSchema | undefined): Json {
  if (v.type === 'string') return v.text;
  if (v.type === 'number') {
    const n = Number(v.text.replace(/[fF]$/, ''));
    if (fs && isIntegerType(fs.type) && /64/.test(fs.type) && !Number.isSafeInteger(n)) return v.text;
    return Number.isFinite(n) ? n : v.text;
  }
  // identifiers: enums, booleans, inf/nan
  if (v.text === 'true' || v.text === 'True' || v.text === 't') return true;
  if (v.text === 'false' || v.text === 'False' || v.text === 'f') return false;
  return v.text;
}

// ---------------------------------------------------------------------------------------------
// JSON → text (editor style). Indentation is two spaces per level; fields are written in field-number order.

export interface PrintOptions {
  /** Nesting level of the document being printed: 0 = a file, ≥1 = embedded data inside another document. */
  docLevel: number;
}

export function printDocument(obj: JsonObject, messageType: string | undefined, opts: PrintOptions): string {
  return printBody(obj, messageType, '', opts);
}

export function printBody(obj: JsonObject, messageType: string | undefined, indent: string, opts: PrintOptions): string {
  let out = '';
  for (const [name, value] of orderedEntries(obj, messageType)) {
    const fs = messageType ? fieldSchema(messageType, name) : undefined;
    if (messageType && !fs) throw new EncodeError(unknownFieldMessage(messageType, name));
    if (value === null || value === undefined) continue;
    if (Array.isArray(value)) {
      if (fs && fs.label !== 'repeated') throw new EncodeError(`Field "${name}" is not repeated; give a single value, not a list.`);
      for (const item of value) out += printField(name, item, fs, indent, opts, obj, messageType);
    } else {
      out += printField(name, value, fs, indent, opts, obj, messageType);
    }
  }
  return out;
}

export function printField(
  name: string,
  value: Json,
  fs: FieldSchema | undefined,
  indent: string,
  opts: PrintOptions,
  parentObj: JsonObject,
  parentType: string | undefined,
): string {
  if (isEmbeddedDataField(parentType, name) && value !== null && typeof value === 'object' && !Array.isArray(value)) {
    const innerType = embeddedTypeFor(parentType, name, parentObj);
    if (!innerType && parentType === 'dmGameObjectDDF.EmbeddedComponentDesc') {
      throw new EncodeError(`Cannot encode embedded component data: unknown or missing "type" (${JSON.stringify(parentObj.type)}).`);
    }
    // String fields inside the embedded document are split after newlines by stringLiteral(); nested data
    // literals inside it stay on one line (encodeEmbeddedLiteral with docLevel ≥ 1), matching the editor.
    const inner = printDocument(value, innerType, { docLevel: opts.docLevel + 1 });
    return `${indent}${name}: ${encodeEmbeddedLiteral(inner, opts.docLevel)}\n`;
  }
  if (fs?.kind === 'message' || (value !== null && typeof value === 'object' && !Array.isArray(value))) {
    if (value === null || typeof value !== 'object' || Array.isArray(value)) {
      throw new EncodeError(`Field "${name}" is a message (${fs?.type.split('.').pop()}); give an object.`);
    }
    if (fs?.type === 'dmStructDDF.Value' && isSingleScalar(value)) {
      // The editor writes scalar struct values on one line: value { number: 2.0 }
      const [k, v] = Object.entries(value)[0]!;
      return `${indent}${name} { ${k}: ${formatScalar(v, fieldSchema(fs.type, k), k)} }\n`;
    }
    const body = printBody(value, fs?.type, indent + '  ', opts);
    return `${indent}${name} {\n${body}${indent}}\n`;
  }
  return `${indent}${name}: ${formatScalar(value, fs, name)}\n`;
}

function isSingleScalar(value: JsonObject): boolean {
  const entries = Object.entries(value);
  return entries.length === 1 && (typeof entries[0]![1] !== 'object' || entries[0]![1] === null);
}

function orderedEntries(obj: JsonObject, messageType: string | undefined): Array<[string, Json]> {
  const entries = Object.entries(obj);
  if (!messageType) return entries;
  if (!messageSchema(messageType)) return entries;
  const order = fieldRank(messageType);
  return entries.sort((a, b) => (order.get(a[0]) ?? 1e9) - (order.get(b[0]) ?? 1e9));
}

export function formatScalar(value: Json, fs: FieldSchema | undefined, name = ''): string {
  if (!fs) {
    // Unknown schema (extension types): infer from the JSON type.
    if (typeof value === 'string') return /^[A-Z][A-Z0-9_]*$/.test(value) ? value : stringLiteral(value);
    if (typeof value === 'boolean') return value ? 'true' : 'false';
    if (typeof value === 'number') return Number.isInteger(value) ? String(value) : javaFloatToString(value);
    throw new EncodeError(`Unsupported value for "${name}": ${JSON.stringify(value)}`);
  }
  if (fs.kind === 'enum') {
    const e = enumSchema(fs.type);
    if (typeof value === 'number') {
      const hit = e?.values.find((x) => x.number === value);
      if (!hit) throw new EncodeError(`Invalid value ${value} for enum field "${name}". Allowed: ${e?.values.map((x) => x.name).join(', ')}`);
      return hit.name;
    }
    if (typeof value !== 'string') throw new EncodeError(`Field "${name}" expects an enum name (${e?.values.map((x) => x.name).join(', ')}).`);
    const exact = e?.values.find((x) => x.name === value);
    if (exact) return exact.name;
    const byDisplay = e?.values.find((x) => x.displayName?.toLowerCase() === value.toLowerCase() || x.name.toLowerCase() === value.toLowerCase());
    if (byDisplay) return byDisplay.name;
    throw new EncodeError(`Invalid value "${value}" for "${name}". Allowed: ${e?.values.map((x) => x.name).join(', ')}`);
  }
  switch (fs.type) {
    case 'string':
    case 'bytes':
      if (typeof value !== 'string' && typeof value !== 'number') throw new EncodeError(`Field "${name}" expects a string.`);
      return stringLiteral(String(value));
    case 'bool':
      if (typeof value === 'boolean') return value ? 'true' : 'false';
      if (value === 0 || value === 1) return value ? 'true' : 'false';
      if (value === 'true' || value === 'false') return value;
      throw new EncodeError(`Field "${name}" expects true/false.`);
    default:
      if (isFloatType(fs.type)) {
        const n = typeof value === 'string' ? Number(value) : value;
        if (typeof n !== 'number' || !Number.isFinite(n)) throw new EncodeError(`Field "${name}" expects a number.`);
        return javaFloatToString(n, fs.type === 'float');
      }
      if (isIntegerType(fs.type)) {
        if (typeof value === 'boolean') return value ? '1' : '0';
        const n = typeof value === 'string' ? Number(value) : value;
        if (typeof value === 'string' && /^-?\d+$/.test(value)) return value;
        if (typeof n !== 'number' || !Number.isFinite(n)) throw new EncodeError(`Field "${name}" expects an integer.`);
        if (!Number.isInteger(n)) throw new EncodeError(`Field "${name}" expects an integer, got ${n}.`);
        if (/^u|fixed/.test(fs.type) && n < 0) throw new EncodeError(`Field "${name}" must not be negative.`);
        return String(n);
      }
      throw new EncodeError(`Unsupported field type ${fs.type} for "${name}".`);
  }
}

/** A quoted string, split after newlines like the Defold editor does. */
export function stringLiteral(text: string): string {
  return breakEmbeddedNewlines(`"${escapeJavaTextFormat(text)}"`);
}

/**
 * Encode an embedded document as a string literal for a document at `docLevel`.
 * Literals inside a file (level 0) are split after every escaped newline (the editor's save post-pass);
 * literals inside embedded documents stay on one line (the outer file's pass splits them).
 */
export function encodeEmbeddedLiteral(innerText: string, docLevel: number): string {
  const lit = `"${escapeJavaTextFormat(innerText)}"`;
  return docLevel === 0 ? breakEmbeddedNewlines(lit) : lit;
}

// ---------------------------------------------------------------------------------------------
// Helpers

export function unknownFieldMessage(messageType: string, name: string): string {
  const schema = messageSchema(messageType);
  const names = schema?.fields.map((f) => f.name) ?? [];
  const suggestion = closest(name, names);
  return `Unknown field "${name}" in ${messageType.split('.').pop()}${suggestion ? ` (did you mean "${suggestion}"?)` : ''}. Fields: ${names.join(', ')}`;
}

export function closest(word: string, candidates: string[]): string | undefined {
  let best: string | undefined;
  let bestD = Infinity;
  for (const c of candidates) {
    const d = levenshtein(word.toLowerCase(), c.toLowerCase());
    if (d < bestD) {
      bestD = d;
      best = c;
    }
  }
  return best !== undefined && bestD <= Math.max(2, Math.floor(word.length / 3)) ? best : undefined;
}

function levenshtein(a: string, b: string): number {
  const dp = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    let prev = dp[0]!;
    dp[0] = i;
    for (let j = 1; j <= b.length; j++) {
      const tmp = dp[j]!;
      dp[j] = Math.min(dp[j]! + 1, dp[j - 1]! + 1, prev + (a[i - 1] === b[j - 1] ? 0 : 1));
      prev = tmp;
    }
  }
  return dp[b.length]!;
}

/** Find a field node's child message value (helper for selectors). */
export function childText(field: FieldNode, child: string): string | undefined {
  if (field.value.kind !== 'message') return undefined;
  const c = field.value.fields.find((f) => f.name === child);
  return c && c.value.kind === 'scalar' ? c.value.text : undefined;
}
