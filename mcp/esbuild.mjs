// Bundles the MCP server and the hook entry point into self-contained ESM files inside the plugin,
// so users of the plugin never need to run `npm install`.
import { build } from 'esbuild';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const here = path.dirname(fileURLToPath(import.meta.url));
const outdir = path.resolve(here, '../plugins/defold/dist');

const common = {
  bundle: true,
  platform: 'node',
  format: 'esm',
  target: 'node20',
  minify: true,
  legalComments: 'eof',
  outExtension: { '.js': '.mjs' },
  logLevel: 'info',
  // Some CommonJS dependencies call require(); provide it in the ESM bundle.
  banner: {
    js: "import { createRequire as __defoldCreateRequire } from 'node:module'; const require = __defoldCreateRequire(import.meta.url);",
  },
};

await build({ ...common, entryPoints: { server: path.join(here, 'src/server.ts') }, outdir });
await build({ ...common, entryPoints: { hook: path.join(here, 'src/hook.ts') }, outdir });
