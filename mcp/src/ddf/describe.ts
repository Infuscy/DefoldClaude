// Human-readable schema description of a resource type (for read_resource describe=true).
import { embeddedDataSpec, enumSchema, messageSchema, shortType, type FieldSchema } from './schema.js';

const VECTOR_LIKE = /^dmMath\./;

export function describeMessage(type: string, title: string): string {
  const schema = messageSchema(type);
  if (!schema) return `No schema for ${type}.`;
  const lines = [`${shortType({ type, kind: 'message' } as FieldSchema)} — ${title}`, 'Fields (in file order):'];
  for (const f of schema.fields) {
    if (f.runtimeOnly) continue;
    lines.push(`- ${describeField(type, f)}`);
  }
  // Expand nested message types one level deep (skipping math vectors, which are self-explanatory).
  const nested = new Set<string>();
  for (const f of schema.fields) if (f.kind === 'message' && !VECTOR_LIKE.test(f.type) && !f.runtimeOnly) nested.add(f.type);
  for (const n of nested) {
    const ns = messageSchema(n);
    if (!ns) continue;
    lines.push('', `${n.split('.').pop()}:`);
    for (const f of ns.fields) if (!f.runtimeOnly) lines.push(`  - ${describeField(n, f)}`);
  }
  return lines.join('\n');
}

function describeField(parentType: string, f: FieldSchema): string {
  let t: string;
  if (embeddedDataSpec(parentType, f.name)) {
    t = parentType.endsWith('EmbeddedInstanceDesc')
      ? 'embedded game object document (string; give a JSON object like a .go file to edit_resource)'
      : 'embedded component document (string; give a JSON object like the component file, matching "type")';
  } else if (f.kind === 'enum') {
    const e = enumSchema(f.type);
    const values = e?.values.map((v) => (v.displayName ? `${v.name} (${v.displayName})` : v.name)) ?? [];
    t = `enum ${shortType(f)}: ${values.length > 16 ? values.slice(0, 16).join(', ') + ', …' : values.join(', ')}`;
  } else if (f.kind === 'message') {
    t = VECTOR_LIKE.test(f.type) ? `${shortType(f)} { x y z${/Quat|Vector4|Point4/.test(f.type) ? ' w' : ''} }` : `${shortType(f)} { … }`;
  } else {
    t = f.type;
  }
  const flags = [f.label === 'repeated' ? 'repeated' : f.label === 'required' ? 'required' : '', f.resource ? 'resource path' : '']
    .filter(Boolean)
    .join(', ');
  const def = f.default !== undefined && f.default !== '' ? ` = ${JSON.stringify(f.default)}` : '';
  return `${f.name}: ${t}${flags ? ` [${flags}]` : ''}${def}`;
}
