// Generate src/ddf/gameproject.generated.json (game.project settings schema) and src/ddf/builtins.generated.json
// (list of /builtins/ resources) from the local Defold editor jar.
// Usage: npx tsx scripts/gen-gameproject.ts
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { locateDefold } from '../src/env/locate.js';
import { ZipFile } from '../src/env/zip.js';
import { parseMetaProperties } from '../src/ddf/gameproject.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const { install } = locateDefold();
if (!install?.jarPath) throw new Error('Defold jar not found');
const zip = await ZipFile.open(install.jarPath);
try {
  const meta = parseMetaProperties(await zip.readText('com/dynamo/bob/meta.properties'));
  const outMeta = path.resolve(here, '../src/ddf/gameproject.generated.json');
  fs.writeFileSync(outMeta, JSON.stringify({ defoldVersion: install.version, sections: meta }));
  console.log(`wrote ${outMeta}: ${Object.keys(meta).length} sections`);

  const builtins = zip
    .list('builtins/')
    .map((e) => '/' + e.name)
    .sort();
  const outBuiltins = path.resolve(here, '../src/ddf/builtins.generated.json');
  fs.writeFileSync(outBuiltins, JSON.stringify({ defoldVersion: install.version, files: builtins }));
  console.log(`wrote ${outBuiltins}: ${builtins.length} files`);
} finally {
  zip.close();
}
