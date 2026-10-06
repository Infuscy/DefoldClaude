// Access to the Defold resource schema generated from the engine's .proto files (scripts/gen-schema.ts).
import schemaJson from './schema.generated.json' with { type: 'json' };
import fieldOrderJson from './fieldorder.generated.json' with { type: 'json' };

export interface FieldSchema {
  name: string;
  number: number;
  label: 'required' | 'optional' | 'repeated';
  type: string;
  kind: 'scalar' | 'enum' | 'message';
  default?: string | number | boolean;
  resource?: true;
  runtimeOnly?: true;
}

export interface MessageSchema {
  fields: FieldSchema[];
}

export interface EnumSchema {
  values: Array<{ name: string; number: number; displayName?: string }>;
}

interface SchemaFile {
  defoldVersion: string;
  extensions: Record<string, string>;
  embeddedTypes: Record<string, string>;
  embeddedData: Record<string, { message?: string; byTypeField?: string }>;
  messages: Record<string, MessageSchema>;
  enums: Record<string, EnumSchema>;
}

const schema = schemaJson as unknown as SchemaFile;
const fieldIndex = new Map<string, Map<string, FieldSchema>>();

export const SCHEMA_DEFOLD_VERSION = schema.defoldVersion;

export function messageSchema(name: string): MessageSchema | undefined {
  return schema.messages[name];
}

export function enumSchema(name: string): EnumSchema | undefined {
  return schema.enums[name];
}

export function fieldSchema(message: string, field: string): FieldSchema | undefined {
  let idx = fieldIndex.get(message);
  if (!idx) {
    const m = schema.messages[message];
    if (!m) return undefined;
    idx = new Map(m.fields.map((f) => [f.name, f]));
    fieldIndex.set(message, idx);
  }
  return idx.get(field);
}

/** Message type for a resource path or extension (".collection", "collection", "/main/x.collection"). */
export function messageForResource(pathOrExt: string): string | undefined {
  const ext = pathOrExt.includes('.') ? pathOrExt.slice(pathOrExt.lastIndexOf('.') + 1) : pathOrExt;
  return schema.extensions[ext.toLowerCase()];
}

export function knownExtensions(): string[] {
  return Object.keys(schema.extensions);
}

/** Message type of an embedded component given its `type` field ("sprite" → SpriteDesc). */
export function messageForEmbeddedType(type: string): string | undefined {
  return schema.embeddedTypes[type] ?? schema.extensions[type];
}

/**
 * If `message.field` holds an embedded text-format document, return how to find its message type.
 * EmbeddedInstanceDesc.data → PrototypeDesc; EmbeddedComponentDesc.data → by the sibling `type` field.
 */
export function embeddedDataSpec(message: string, field: string): { message?: string; byTypeField?: string } | undefined {
  return schema.embeddedData[`${message}.${field}`];
}

export function isFloatType(t: string): boolean {
  return t === 'float' || t === 'double';
}

export function isIntegerType(t: string): boolean {
  return /^(u?int(32|64)|s?fixed(32|64)|sint(32|64))$/.test(t);
}

export function shortType(f: FieldSchema): string {
  return f.kind === 'scalar' ? f.type : f.type.split('.').pop()!;
}

const learnedOrder = fieldOrderJson as unknown as Record<string, string[]>;
const orderMemo = new Map<string, Map<string, number>>();

/**
 * Position of each field when the Defold editor writes a message: field-number order, except for the few
 * message types where the editor's output (learned from editor-saved files) places later fields elsewhere.
 */
export function fieldRank(message: string): Map<string, number> {
  let ranks = orderMemo.get(message);
  if (ranks) return ranks;
  const schemaNames = (messageSchema(message)?.fields ?? []).map((f) => f.name);
  const learned = learnedOrder[message] ?? [];
  const order = [...learned];
  for (let i = 0; i < schemaNames.length; i++) {
    const n = schemaNames[i]!;
    if (order.includes(n)) continue;
    // Insert after the closest preceding schema field that is already placed.
    let at = 0;
    for (let j = i - 1; j >= 0; j--) {
      const k = order.indexOf(schemaNames[j]!);
      if (k >= 0) {
        at = k + 1;
        break;
      }
    }
    order.splice(at, 0, n);
  }
  ranks = new Map(order.map((n, i) => [n, i]));
  orderMemo.set(message, ranks);
  return ranks;
}
