import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { encodeEmbeddedLiteral } from '../../src/ddf/codec.js';
import { fileReferences, matches, type Target } from '../../src/ddf/references.js';
import { findReferencesTool } from '../../src/tools/findReferences.js';
import { findReferencesInput } from '../../src/tools/schemas.js';

const file = (target: string, folder = false): Target => ({ path: target, folder });
const found = (resource: string, text: string, target: Target) => fileReferences(resource, text, target).filter((r) => matches(r, target));

const sprite = 'default_animation: "idle"\nmaterial: "/builtins/materials/sprite.material"\ntextures {\n  sampler: "texture_sampler"\n  texture: "/main/hero.atlas"\n}\n';
const heroGo = `components {\n  id: "hero"\n  component: "/main/hero.script"\n}\nembedded_components {\n  id: "sprite"\n  type: "sprite"\n  data: ${encodeEmbeddedLiteral(sprite, 0)}\n}\n`;
const collection = `name: "main"\ninstances {\n  id: "enemy"\n  prototype: "/main/enemy.go"\n}\nembedded_instances {\n  id: "hero"\n  data: ${encodeEmbeddedLiteral(heroGo, 0)}\n}\n`;

describe('fileReferences', () => {
  it('finds schema resource fields with their owner, also two levels of embedding deep', () => {
    expect(found('/main/main.collection', collection, file('/main/enemy.go'))).toEqual([{ path: '/main/enemy.go', line: 4, via: 'prototype (id "enemy")' }]);
    const atlas = found('/main/main.collection', collection, file('/main/hero.atlas'));
    expect(atlas).toHaveLength(1);
    expect(atlas[0]!.via).toBe("texture (in embedded component 'sprite' in game object 'hero')");
    expect(found('/main/main.collection', collection, file('/main/hero.script'))[0]!.via).toBe(`component (id "hero", in game object 'hero')`);
  });

  it('finds require in dotted, call and slash forms, and path strings, but not comments or object URLs', () => {
    const lua = [
      'local util = require "modules.util"',
      'local util2 = require("modules.util")',
      'local bad = require("modules/util.lua")',
      '-- require "modules.util"',
      'go.property("skin", resource.atlas("/main/hero.atlas"))',
      'msg.post("/main/hero.atlas#sprite", "x")',
    ].join('\n');
    expect(found('/main/a.script', lua, file('/modules/util.lua')).map((r) => [r.line, r.via])).toEqual([
      [1, 'require "modules.util"'],
      [2, 'require "modules.util"'],
      [3, 'require "modules/util.lua"'],
    ]);
    expect(found('/main/a.script', lua, file('/main/hero.atlas')).map((r) => r.line)).toEqual([5]);
  });

  it('maps compiled game.project paths to their source and treats folder settings as folders', () => {
    const gp = '[bootstrap]\nmain_collection = /main/main.collectionc\n\n[project]\ncustom_resources = /res,/levels/one.json\n';
    expect(found('/game.project', gp, file('/main/main.collection'))).toEqual([{ path: '/main/main.collection', line: 2, via: '[bootstrap] main_collection' }]);
    expect(found('/game.project', gp, file('/res/data.json')).map((r) => r.path)).toEqual(['/res']);
    expect(found('/game.project', gp, file('/levels/one.json'))).toHaveLength(1);
  });

  it('resolves relative shader includes', () => {
    expect(found('/shaders/a.fp', '#include "common.glsl"\nvoid main() {}\n', file('/shaders/common.glsl'))[0]!.via).toBe('#include "common.glsl"');
  });

  it('falls back to quoted path matches where the schema has no field (extension components, broken files)', () => {
    const go = 'embedded_components {\n  id: "spine"\n  type: "spinemodel"\n  data: "spine_scene: \\"/main/hero.spinescene\\"\\n"\n}\n';
    expect(found('/main/a.go', go, file('/main/hero.spinescene'))).toEqual([{ path: '/main/hero.spinescene', line: 4, via: 'text match' }]);
    expect(found('/main/b.go', 'components {\n  component: "/main/hero.script"\n', file('/main/hero.script'))[0]!.line).toBe(2);
  });

  it('matches everything below a folder, not folders that merely share a prefix', () => {
    const refs = found('/main/main.collection', collection, file('/main', true)).map((r) => r.path);
    expect(refs).toEqual(expect.arrayContaining(['/main/enemy.go', '/main/hero.script', '/main/hero.atlas']));
    expect(found('/main/main.collection', collection, file('/mai', true))).toEqual([]);
  });
});

describe('find_references tool', () => {
  let tmp: string;
  const run = async (args: object) => {
    const res = await findReferencesTool.handler(findReferencesInput.parse({ project: tmp, ...args }), { signal: new AbortController().signal, progress: async () => {} });
    return (res.content[0] as { text: string }).text;
  };

  beforeAll(() => {
    tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'defold refs '));
    const write = (rel: string, text: string) => {
      fs.mkdirSync(path.dirname(path.join(tmp, rel)), { recursive: true });
      fs.writeFileSync(path.join(tmp, rel), text);
    };
    write('game.project', '[bootstrap]\nmain_collection = /main/main.collectionc\n');
    write('main/main.collection', collection);
    write('main/hero.script', 'local util = require "modules.util"\n');
    write('modules/util.lua', 'return {}\n');
    write('build/default/main/hero.script', 'require "modules.util"\n');
  });

  afterAll(() => fs.rmSync(tmp, { recursive: true, force: true }));

  it('accepts a module name and skips build output', async () => {
    const out = await run({ path: 'modules.util' });
    expect(out).toContain('1 reference to /modules/util.lua (require "modules.util") in 1 file');
    expect(out).toContain('/main/hero.script\n  1: require "modules.util"');
  });

  it('lists referenced paths for a folder and notes missing targets', async () => {
    expect(await run({ path: '/main/' })).toContain('→ /main/enemy.go');
    expect(await run({ path: '/main/gone.png' })).toMatch(/^No references .*\nNote: \/main\/gone\.png does not exist/);
  });
});
