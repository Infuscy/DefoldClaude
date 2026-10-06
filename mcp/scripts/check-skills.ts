// Fail if a skill mentions a Defold API entry that does not exist in the installed version, or a tool that
// the MCP server does not provide. Usage: npx tsx scripts/check-skills.ts
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadApiIndex } from '../src/docs/apiIndex.js';
import { locateDefold } from '../src/env/locate.js';
import { ALL_TOOLS } from '../src/server.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const skillsDir = path.resolve(here, '../../plugins/defold/skills');
const agentsDir = path.resolve(here, '../../plugins/defold/agents');

const NAMESPACES = [
  'go', 'msg', 'vmath', 'gui', 'sprite', 'label', 'factory', 'collectionfactory', 'collectionproxy', 'physics', 'sound',
  'timer', 'sys', 'window', 'camera', 'render', 'resource', 'particlefx', 'tilemap', 'model', 'json', 'http', 'image',
  'buffer', 'crash', 'profiler', 'zlib', 'html5', 'liveupdate', 'b2d', 'graphics', 'font', 'material', 'editor',
];
// Lua standard library members the API index does not list exhaustively.
const ALLOW = new Set(['sys.exit', 'json.encode', 'json.decode', 'editor.tx', 'render.predicate']);

const { install } = locateDefold();
if (!install) throw new Error('Defold not found');
const elements = await loadApiIndex(install);
const known = new Set<string>();
for (const e of elements) {
  known.add(e.name);
  for (const m of e.members) known.add(m.name);
}
const toolNames = new Set(ALL_TOOLS.map((t) => t.name));

const files: string[] = [];
const walk = (d: string) => {
  if (!fs.existsSync(d)) return;
  for (const e of fs.readdirSync(d, { withFileTypes: true })) {
    const p = path.join(d, e.name);
    if (e.isDirectory()) walk(p);
    else if (e.name.endsWith('.md') && e.name !== 'api-core.md') files.push(p);
  }
};
walk(skillsDir);
walk(agentsDir);

const apiRe = new RegExp(`\\b(${NAMESPACES.join('|')})\\.([a-z_][a-z0-9_]*(?:\\.[a-z_][a-z0-9_]*)*|[A-Z][A-Z0-9_]*)\\b`, 'g');
const toolRe = /mcp__plugin_defold_defold__([a-z_]+)/g;
const problems: string[] = [];
let checked = 0;
for (const file of files) {
  const text = fs.readFileSync(file, 'utf8');
  const lines = text.split('\n');
  let inToolTable = false;
  lines.forEach((line, i) => {
    if (!line.startsWith('|')) inToolTable = false;
    else if (/\|\s*Tools?\s*\|/.test(line)) inToolTable = true;
    for (const m of line.matchAll(apiRe)) {
      const name = `${m[1]}.${m[2]}`;
      // Skip file names and paths like main.script, player.go, go.property is real; ignore resource paths.
      if (/[\\/]/.test(line[m.index! - 1] ?? '') || /\.(script|go|collection|gui|lua|atlas|sprite)\b/.test(name)) continue;
      if (/^(go\.(PLAYBACK|EASING)_\*|msg\.url\(\))$/.test(name)) continue;
      checked++;
      if (!known.has(name) && !ALLOW.has(name) && !known.has(name.replace(/_\*$/, ''))) {
        problems.push(`${path.relative(skillsDir, file)}:${i + 1}: unknown API "${name}"`);
      }
    }
    for (const m of line.matchAll(toolRe)) {
      if (!toolNames.has(m[1]!)) problems.push(`${path.relative(skillsDir, file)}:${i + 1}: unknown tool "${m[1]}"`);
    }
    // In tables whose header has a "Tool" column, the last column lists tool names in backticks.
    if (inToolTable && !/\|\s*Tools?\s*\|/.test(line) && !/^\|[-\s|]+\|$/.test(line)) {
      const cells = line.split('|').map((c) => c.trim()).filter(Boolean);
      const last = (cells[cells.length - 1] ?? '').replace(/\([^)]*\)/g, '');
      for (const m of last.matchAll(/`([a-z_]+)`/g)) {
        if (!toolNames.has(m[1]!)) problems.push(`${path.relative(skillsDir, file)}:${i + 1}: unknown tool "${m[1]}"`);
      }
    }
  });
}
console.log(`checked ${checked} API mentions in ${files.length} files`);
if (problems.length) {
  console.error(problems.join('\n'));
  process.exit(1);
}
console.log('all API and tool names exist');
