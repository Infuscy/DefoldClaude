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
  logLevel: 'warning',
  // Some CommonJS dependencies call require(); provide it in the ESM bundle.
  banner: {
    js: "import { createRequire as __defoldCreateRequire } from 'node:module'; const require = __defoldCreateRequire(import.meta.url);",
  },
};

// On Windows a freshly written bundle can be briefly locked (antivirus scan, a test process); retry a few times.
async function buildWithRetry(options) {
  for (let attempt = 1; ; attempt++) {
    try {
      return await build(options);
    } catch (err) {
      if (attempt >= 4 || !/user-mapped section|EBUSY|EPERM/.test(String(err))) throw err;
      await new Promise((r) => setTimeout(r, 1000 * attempt));
    }
  }
}

for (const entry of ['server', 'hook']) {
  await buildWithRetry({ ...common, entryPoints: { [entry]: path.join(here, `src/${entry}.ts`) }, outdir });
  console.log(`built ${path.relative(process.cwd(), path.join(outdir, entry + '.mjs'))}`);
}
