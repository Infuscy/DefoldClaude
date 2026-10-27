// Download/collect Defold text resources used by the corpus tests into test/corpus/ (gitignored).
// Sources: Defold's editor round-trip project (save_data_project @ tag), defold/examples (CC0),
// the local editor jar's builtins, and a local project (read-only copy of its text files).
// Usage: npx tsx scripts/fetch-corpus.ts [tag=1.14.0] [localProject="C:/GIT/DefoldProjects/Mobile Game"]
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { locateDefold } from '../src/env/locate.js';
import { ZipFile } from '../src/env/zip.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const corpus = path.resolve(here, '../test/corpus');
const tag = process.argv[2] ?? '1.14.0';
const localProject = process.argv[3] ?? 'C:/GIT/DefoldProjects/Mobile Game';
const BINARY = /\.(png|jpe?g|gif|webp|ogg|wav|mp3|ttf|otf|glb|gltf|bin|dae|fbx|car|zip|jar|so|dll|exe|a|lib|icns|ico|psd|ktx|basis|xcf|pdf)$/i;

function save(rel: string, data: Buffer | string): void {
  const dest = path.join(corpus, rel);
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  fs.writeFileSync(dest, data);
}

async function fetchSaveDataProject(): Promise<void> {
  const base = 'editor/test/resources/save_data_project';
  const target = path.join(corpus, 'save_data_project');
  if (fs.existsSync(target)) return console.log('save_data_project: cached');
  const listDir = (dir: string): Array<{ path: string; type: string }> =>
    JSON.parse(execFileSync('gh', ['api', `repos/defold/defold/contents/${dir}?ref=${tag}`, '--jq', '[.[] | {path, type}]'], { encoding: 'utf8' }));
  const stack = [base];
  let n = 0;
  while (stack.length) {
    const dir = stack.pop()!;
    for (const e of listDir(dir)) {
      if (e.type === 'dir') stack.push(e.path);
      else if (!BINARY.test(e.path)) {
        const res = await fetch(`https://raw.githubusercontent.com/defold/defold/${tag}/${e.path}`);
        if (!res.ok) throw new Error(`${e.path}: HTTP ${res.status}`);
        save(path.join('save_data_project', path.relative(base, e.path)), Buffer.from(await res.arrayBuffer()));
        n++;
      }
    }
  }
  console.log(`save_data_project: ${n} files`);
}

async function fetchExamples(): Promise<void> {
  const target = path.join(corpus, 'examples');
  if (fs.existsSync(target)) return console.log('examples: cached');
  const zipPath = path.join(corpus, '.examples.zip');
  if (!fs.existsSync(zipPath)) {
    console.log('downloading defold/examples (~90 MB)…');
    const res = await fetch('https://codeload.github.com/defold/examples/zip/refs/heads/master');
    if (!res.ok) throw new Error(`examples: HTTP ${res.status}`);
    fs.mkdirSync(corpus, { recursive: true });
    fs.writeFileSync(zipPath, Buffer.from(await res.arrayBuffer()));
  }
  const zip = await ZipFile.open(zipPath);
  let n = 0;
  try {
    for (const e of zip.list()) {
      if (BINARY.test(e.name)) continue;
      const rel = e.name.split('/').slice(1).join('/'); // strip "examples-master/"
      if (!rel) continue;
      save(path.join('examples', rel), await zip.read(e.name));
      n++;
    }
  } finally {
    zip.close();
  }
  fs.rmSync(zipPath);
  console.log(`examples: ${n} files`);
}

async function collectBuiltins(): Promise<void> {
  const target = path.join(corpus, 'builtins');
  if (fs.existsSync(target)) return console.log('builtins: cached');
  const { install } = locateDefold();
  if (!install?.jarPath) return console.log('builtins: skipped (no Defold jar)');
  const zip = await ZipFile.open(install.jarPath);
  let n = 0;
  try {
    for (const e of zip.list('builtins/')) {
      if (BINARY.test(e.name)) continue;
      save(e.name, await zip.read(e.name));
      n++;
    }
    for (const e of zip.list('templates/')) {
      save(path.join('editor-templates', path.basename(e.name)), await zip.read(e.name));
    }
  } finally {
    zip.close();
  }
  console.log(`builtins: ${n} files (+ editor templates)`);
}

function collectLocal(): void {
  const target = path.join(corpus, 'local');
  if (!fs.existsSync(localProject)) return console.log('local: skipped');
  fs.rmSync(target, { recursive: true, force: true });
  let n = 0;
  const walk = (dir: string) => {
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      if (['build', '.internal', '.git'].includes(e.name)) continue;
      const p = path.join(dir, e.name);
      if (e.isDirectory()) walk(p);
      else if (!BINARY.test(e.name)) {
        save(path.join('local', path.relative(localProject, p)), fs.readFileSync(p));
        n++;
      }
    }
  };
  walk(localProject);
  console.log(`local: ${n} files from ${localProject}`);
}

await fetchSaveDataProject();
await collectBuiltins();
collectLocal();
await fetchExamples();
