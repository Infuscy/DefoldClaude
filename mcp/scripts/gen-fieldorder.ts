// Learn the field order the Defold editor writes for each message type from editor-saved files
// (save_data_project) and store it in src/ddf/fieldorder.generated.json. The editor does not always use
// proto field-number order (e.g. Sampler.wrap_w is written after wrap_v), and matching it keeps diffs small.
// Usage: npx tsx scripts/gen-fieldorder.ts   (needs test/corpus from fetch-corpus)
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { embeddedTypeFor, isEmbeddedDataField } from '../src/ddf/codec.js';
import { fieldSchema, messageForResource, messageSchema } from '../src/ddf/schema.js';
import { parseTextFormat, type MessageValue } from '../src/ddf/textformat.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const dir = path.resolve(here, '../test/corpus/save_data_project');
const out = path.resolve(here, '../src/ddf/fieldorder.generated.json');

// For each message type, collect "a before b" observations, then topologically order the observed fields.
const before = new Map<string, Map<string, Set<string>>>();
const seen = new Map<string, Set<string>>();

function observe(msg: MessageValue, type: string | undefined): void {
  if (!type) return;
  const names = msg.fields.map((f) => f.name);
  const s = seen.get(type) ?? new Set<string>();
  names.forEach((n) => s.add(n));
  seen.set(type, s);
  const b = before.get(type) ?? new Map<string, Set<string>>();
  for (let i = 0; i < names.length; i++) {
    for (let j = i + 1; j < names.length; j++) {
      if (names[i] === names[j]) continue;
      if (!b.has(names[i]!)) b.set(names[i]!, new Set());
      b.get(names[i]!)!.add(names[j]!);
    }
  }
  before.set(type, b);
  for (const f of msg.fields) {
    const fs_ = fieldSchema(type, f.name);
    if (isEmbeddedDataField(type, f.name) && f.value.kind === 'scalar') {
      observe(parseTextFormat(f.value.text).root, embeddedTypeFor(type, f.name, msg));
    } else if (f.value.kind === 'message' && fs_?.kind === 'message') {
      observe(f.value, fs_.type);
    }
  }
}

for (const name of fs.readdirSync(dir)) {
  const type = messageForResource(name);
  if (!type || !name.startsWith('checked')) continue;
  observe(parseTextFormat(fs.readFileSync(path.join(dir, name), 'utf8')).root, type);
}

const result: Record<string, string[]> = {};
for (const [type, fieldsSeen] of seen) {
  const schemaOrder = (messageSchema(type)?.fields ?? []).map((f) => f.name);
  const rank = (n: string) => {
    const i = schemaOrder.indexOf(n);
    return i < 0 ? 1e6 : i;
  };
  // Kahn's algorithm on observed precedence, tie-broken by schema order.
  const b = before.get(type)!;
  const nodes = [...fieldsSeen];
  const indeg = new Map(nodes.map((n) => [n, 0]));
  for (const [a, succ] of b) for (const s of succ) if (!b.get(s)?.has(a)) indeg.set(s, (indeg.get(s) ?? 0) + 1);
  const order: string[] = [];
  const ready = nodes.filter((n) => indeg.get(n) === 0);
  while (ready.length) {
    ready.sort((x, y) => rank(x) - rank(y));
    const n = ready.shift()!;
    order.push(n);
    for (const s of b.get(n) ?? []) {
      if (b.get(s)?.has(n)) continue;
      indeg.set(s, indeg.get(s)! - 1);
      if (indeg.get(s) === 0) ready.push(s);
    }
  }
  const schemaWise = nodes.slice().sort((x, y) => rank(x) - rank(y));
  if (order.length === nodes.length && order.join() !== schemaWise.join()) result[type] = order;
}
fs.writeFileSync(out, JSON.stringify(result, null, 1));
console.log(`wrote ${out}: ${Object.keys(result).length} message types differ from field-number order`);
for (const [t, o] of Object.entries(result)) console.log(`  ${t}: ${o.join(', ')}`);
