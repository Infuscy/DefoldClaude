// Corpus tests: run `npm run fetch:corpus` first. Skipped when the corpus is missing.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { embeddedTypeFor, encodeEmbeddedLiteral, isEmbeddedDataField, messageToJson, printDocument } from '../../src/ddf/codec.js';
import { checkFile, isCheckable, LUA_EXTENSIONS } from '../../src/ddf/checkfile.js';
import { CrossChecker, inputBindingPath } from '../../src/ddf/crosscheck.js';
import { loadApiIndex } from '../../src/docs/apiIndex.js';
import { apiNames } from '../../src/docs/apiNames.js';
import { locateDefold } from '../../src/env/locate.js';
import { scanLuaText, unknownApiIssues } from '../../src/lua/apicheck.js';
import type { GlobalScan } from '../../src/lua/globals.js';
import { parseIni } from '../../src/util/ini.js';
import { fieldSchema, messageForResource } from '../../src/ddf/schema.js';
import { parseTextFormat, type MessageValue } from '../../src/ddf/textformat.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const corpus = path.resolve(here, '../corpus');
const available = fs.existsSync(corpus);

function listFiles(): string[] {
  const out: string[] = [];
  const walk = (d: string) => {
    for (const e of fs.readdirSync(d, { withFileTypes: true })) {
      const p = path.join(d, e.name);
      if (e.isDirectory()) walk(p);
      else out.push(p);
    }
  };
  if (available) walk(corpus);
  return out;
}

const files = listFiles();
const ddfFiles = files.filter((f) => messageForResource(f));
const luaFiles = files.filter((f) => /\.(script|gui_script|render_script|lua|editor_script)$/.test(f));
/** JSON with object keys sorted, so field order does not matter. */
function canonical(v: unknown): string {
  return JSON.stringify(v, (_k, val) => {
    if (typeof val === 'number' && !Number.isInteger(val)) return Math.fround(val); // float fields compare as float32
    return val && typeof val === 'object' && !Array.isArray(val) ? Object.fromEntries(Object.entries(val).sort(([a], [b]) => a.localeCompare(b))) : val;
  });
}

const resourceOf = (f: string) => '/' + path.relative(corpus, f).split(path.sep).join('/');

describe.skipIf(!available)('corpus', () => {
  it('has enough files to be meaningful', () => {
    expect(ddfFiles.length).toBeGreaterThan(500);
    expect(luaFiles.length).toBeGreaterThan(100);
  });

  it('re-encodes every embedded data literal byte-for-byte', () => {
    let total = 0;
    const mismatches: string[] = [];
    const check = (text: string, msg: MessageValue, type: string | undefined, level: number, file: string) => {
      for (const f of msg.fields) {
        if (isEmbeddedDataField(type, f.name) && f.value.kind === 'scalar') {
          total++;
          if (encodeEmbeddedLiteral(f.value.text, level) !== text.slice(f.value.start, f.value.end)) mismatches.push(`${file}:${f.line}`);
          check(f.value.text, parseTextFormat(f.value.text).root, embeddedTypeFor(type, f.name, msg), level + 1, file);
        } else if (f.value.kind === 'message') {
          const fs_ = type ? fieldSchema(type, f.name) : undefined;
          check(text, f.value, fs_?.kind === 'message' ? fs_.type : undefined, level, file);
        }
      }
    };
    for (const file of ddfFiles) {
      const text = fs.readFileSync(file, 'utf8');
      check(text, parseTextFormat(text).root, messageForResource(file), 0, file);
    }
    expect(total).toBeGreaterThan(500);
    expect(mismatches).toEqual([]);
  });

  it('reports no errors or warnings on valid Defold files (DDF and Lua)', () => {
    const problems: string[] = [];
    for (const file of [...ddfFiles, ...luaFiles]) {
      for (const i of checkFile(resourceOf(file), fs.readFileSync(file, 'utf8'))) {
        if (i.severity === 'error') problems.push(`${file}:${i.line} ${i.message}`);
        if (i.severity === 'warning' && i.rule !== 'component-type') problems.push(`${file}:${i.line} (warning) ${i.message}`);
      }
    }
    expect(problems).toEqual([]);
  });

  it('reports no cross-file findings on valid projects (animations, input actions, message names)', async () => {
    // Every folder with a game.project is a project of its own; its files end where a nested project starts.
    const roots = files.filter((f) => path.basename(f) === 'game.project').map((f) => path.dirname(f)).sort((a, b) => b.length - a.length);
    const byRoot = new Map<string, string[]>(roots.map((r) => [r, []]));
    for (const f of files) {
      const root = roots.find((r) => f.startsWith(r + path.sep));
      if (root) byRoot.get(root)!.push(f);
    }
    expect(roots.length).toBeGreaterThan(50);
    // defold/examples has one handler for an action its binding never produces; the finding is correct.
    const known = /skinning.main.instancing\.script:\d+ \[input-action\].*"EXAMPLE_1"/;
    const problems: string[] = [];
    let sprites = 0;
    let inputScripts = 0;
    for (const [root, own] of byRoot) {
      const resource = (f: string) => '/' + path.relative(root, f).split(path.sep).join('/');
      const cross = new CrossChecker({
        async readText(r) {
          const file = path.join(r.startsWith('/builtins/') ? corpus : root, r);
          return fs.existsSync(file) ? fs.readFileSync(file, 'utf8') : undefined;
        },
        inputBinding: inputBindingPath(parseIni(fs.readFileSync(path.join(root, 'game.project'), 'utf8'))),
        luaFiles: async () => own.map(resource).filter((r) => LUA_EXTENSIONS.test(r)),
      });
      for (const file of own.filter((f) => isCheckable(resource(f)))) {
        const text = fs.readFileSync(file, 'utf8');
        const taps = cross.taps(resource(file));
        if (/action_id\s*==/.test(text)) inputScripts++;
        checkFile(resource(file), text, {
          ...taps,
          onDdfMessage: (v) => {
            if (v.type === 'dmGameSystemDDF.SpriteDesc') sprites++;
            taps.onDdfMessage?.(v);
          },
        });
      }
      for (const i of await cross.finish()) problems.push(`${path.join(root, i.resource!)}:${i.line} [${i.rule}] ${i.message}`);
    }
    expect(sprites).toBeGreaterThan(100);
    expect(inputScripts).toBeGreaterThan(20);
    expect(problems.filter((p) => !known.test(p))).toEqual([]);
  });

  // Needs the API reference of a local Defold install.
  const install = locateDefold().install;
  it.skipIf(!install?.jarPath && !install?.docsPath)('uses only API members the installed Defold has (or that the project defines)', async () => {
    const names = apiNames(await loadApiIndex(install!), [], install!.version);
    // One group per project (nearest game.project); files outside any project (builtins) by their top folder.
    const roots = files.filter((f) => path.basename(f) === 'game.project').map((f) => path.dirname(f)).sort((a, b) => b.length - a.length);
    const groups = new Map<string, Map<string, GlobalScan>>();
    let uses = 0;
    for (const file of luaFiles) {
      const root = roots.find((r) => file.startsWith(r + path.sep)) ?? path.join(corpus, path.relative(corpus, file).split(path.sep)[0]!);
      const scan = scanLuaText(fs.readFileSync(file, 'utf8'), file);
      if (!scan) continue;
      uses += scan.uses.filter((u) => names.roots.has(u.root)).length;
      (groups.get(root) ?? groups.set(root, new Map()).get(root)!).set(file, scan);
    }
    const problems: string[] = [];
    for (const checked of groups.values()) {
      for (const i of await unknownApiIssues(checked, { names: async () => names, others: async () => [] })) problems.push(`${i.resource}:${i.line} ${i.message}`);
    }
    expect(uses).toBeGreaterThan(2000);
    expect(problems).toEqual([]);
  });

  it('decodes to JSON and reprints semantically identical documents', () => {
    const diffs: string[] = [];
    for (const file of ddfFiles) {
      const type = messageForResource(file)!;
      const text = fs.readFileSync(file, 'utf8');
      const json = messageToJson(parseTextFormat(text).root, type);
      let printed: string;
      try {
        printed = printDocument(json, type, { docLevel: 0 });
      } catch (e) {
        diffs.push(`${file}: ${(e as Error).message}`);
        continue;
      }
      const again = messageToJson(parseTextFormat(printed).root, type);
      if (canonical(again) !== canonical(json)) diffs.push(file);
    }
    expect(diffs).toEqual([]);
  });

  it('reprints editor-saved files byte-for-byte from JSON (save_data_project)', () => {
    const diffs: string[] = [];
    // .data files: the editor's own Data serializer adds a blank line after `tags`, which we do not reproduce.
    for (const file of ddfFiles.filter((f) => f.includes(`${path.sep}save_data_project${path.sep}checked`) && !f.endsWith('.data'))) {
      const type = messageForResource(file)!;
      const text = fs.readFileSync(file, 'utf8');
      const printed = printDocument(messageToJson(parseTextFormat(text).root, type), type, { docLevel: 0 });
      if (printed !== text) diffs.push(path.basename(file));
    }
    expect(diffs).toEqual([]);
  });
});
