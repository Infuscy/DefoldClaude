// Generate plugins/defold/skills/defold/references/api-core.md from the installed Defold version's API docs.
// Usage: npx tsx scripts/gen-api-core.ts
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadApiIndex, signature, type ApiElement } from '../src/docs/apiIndex.js';
import { locateDefold } from '../src/env/locate.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const out = path.resolve(here, '../../plugins/defold/skills/defold/references/api-core.md');

const NAMESPACES: Array<[string, string]> = [
  ['go', 'Game objects, properties, animation, lifecycle'],
  ['msg', 'Messaging'],
  ['vmath', 'Vector math'],
  ['builtins', 'Global helpers'],
  ['sprite', 'Sprite component'],
  ['label', 'Label component'],
  ['factory', 'Factory component'],
  ['collectionfactory', 'Collection factory component'],
  ['collectionproxy', 'Collection proxy component'],
  ['physics', 'Physics (high level)'],
  ['camera', 'Camera'],
  ['gui', 'GUI scripts'],
  ['sound', 'Sound'],
  ['particlefx', 'Particle effects'],
  ['tilemap', 'Tile maps'],
  ['model', 'Models'],
  ['timer', 'Timers'],
  ['sys', 'System, files, save data'],
  ['window', 'Window'],
  ['resource', 'Runtime resources'],
  ['json', 'JSON'],
  ['http', 'HTTP'],
  ['render', 'Render scripts'],
];

const { install } = locateDefold();
if (!install) throw new Error('Defold not found');
const all = (await loadApiIndex(install)).filter((e) => e.environment === 'runtime');

const short = (s: string, n = 110) => {
  const one = s.replace(/\s+/g, ' ').trim();
  return one.length > n ? one.slice(0, n - 1) + '…' : one;
};

const lines: string[] = [
  `# Defold ${install.version} Lua API — core cheatsheet`,
  '',
  `Generated from the Defold ${install.version} API documentation (sha1 ${install.sha1}). One line per entry: signature — summary.`,
  'For parameters, return values and examples call the `api` tool with `name=<entry>`; for anything not listed here use `api` with `query=`.',
  'Optional parameters are in [brackets]. Messages are sent with `msg.post(url, "<name>", {fields})` and received in `on_message` (compare `message_id == hash("<name>")`).',
  '',
];

for (const [ns, title] of NAMESPACES) {
  const items = all.filter((e) => e.namespace === ns);
  if (!items.length) continue;
  lines.push(`## ${ns} — ${title}`, '');
  const by = (t: string) => items.filter((e) => e.type === t).sort((a, b) => a.name.localeCompare(b.name));
  const fns = by('FUNCTION');
  if (fns.length) {
    for (const f of fns) lines.push(`- \`${signature(f)}\` — ${short(f.brief)}`);
    lines.push('');
  }
  const messages = by('MESSAGE');
  if (messages.length) {
    lines.push('Messages:');
    for (const m of messages) {
      const fields = m.params.map((p) => p.name).join(', ');
      lines.push(`- \`${m.name}\`${fields ? ` {${fields}}` : ''} — ${short(m.brief, 90)}`);
    }
    lines.push('');
  }
  const props = by('PROPERTY');
  if (props.length) {
    lines.push('Properties (go.get/go.set/go.animate):');
    lines.push(props.map((p) => `\`${p.name}\` (${short(p.brief, 40)})`).join(', '));
    lines.push('');
  }
  const consts = [...by('CONSTANT'), ...by('VARIABLE')];
  const enums = by('ENUM');
  if (consts.length || enums.length) {
    const names = [...consts.map((c) => c.name), ...enums.flatMap((e: ApiElement) => e.members.map((m) => m.name))];
    lines.push(`Constants: ${names.map((n) => `\`${n}\``).join(', ')}`);
    lines.push('');
  }
}

fs.mkdirSync(path.dirname(out), { recursive: true });
fs.writeFileSync(out, lines.join('\n'));
console.log(`wrote ${out} (${lines.length} lines)`);
