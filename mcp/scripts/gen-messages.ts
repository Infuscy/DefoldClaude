// Generate src/lua/messages.generated.json: the names of Defold's built-in messages, from the installed
// version's API docs. The validator uses it to spot misspelled message names.
// Usage: npx tsx scripts/gen-messages.ts
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadApiIndex } from '../src/docs/apiIndex.js';
import { locateDefold } from '../src/env/locate.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const out = path.resolve(here, '../src/lua/messages.generated.json');

// Engine messages the API docs do not list (system/render sockets, camera → render script).
const UNDOCUMENTED = ['set_view_projection', 'draw_text', 'start_record', 'stop_record'];

const { install } = locateDefold();
if (!install) throw new Error('Defold not found');
const documented = (await loadApiIndex(install)).filter((e) => e.type === 'MESSAGE' && e.environment === 'runtime').map((e) => e.name);
const messages = [...new Set([...documented, ...UNDOCUMENTED])].sort();
if (documented.length < 40) throw new Error(`Only ${documented.length} messages found in the API docs; refusing to write`);

fs.writeFileSync(out, JSON.stringify({ defoldVersion: install.version, messages }, null, 2) + '\n');
console.log(`${messages.length} messages (Defold ${install.version}) → ${path.relative(process.cwd(), out)}`);
