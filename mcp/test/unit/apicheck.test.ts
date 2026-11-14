// Unknown-API check: members of Defold's global tables that the installed version does not have. Each accepted case
// is a pattern real projects use (locals named like a table, utility modules extending math, feature tests).
import { describe, expect, it } from 'vitest';
import { checkFile, LUA_EXTENSIONS } from '../../src/ddf/checkfile.js';
import { CrossChecker } from '../../src/ddf/crosscheck.js';
import type { ApiElement } from '../../src/docs/apiIndex.js';
import { apiNames, type ApiNames } from '../../src/docs/apiNames.js';
import { scanLuaText, unknownApiIssues } from '../../src/lua/apicheck.js';
import type { Issue } from '../../src/runtime/issues.js';

const el = (name: string, type = 'FUNCTION', environment: ApiElement['environment'] = 'runtime', members: ApiElement['members'] = []): ApiElement => ({
  name,
  type,
  namespace: name.includes('.') ? name.slice(0, name.lastIndexOf('.')) : 'base',
  brief: '',
  description: '',
  params: [],
  returns: [],
  examples: '',
  members,
  environment,
  source: 'test',
});

const ELEMENTS = [
  ...['go.animate', 'go.get_position', 'go.set_position', 'go.get_world_position', 'go.delete', 'msg.post', 'sprite.play_flipbook', 'sprite.set_hflip'].map((n) => el(n)),
  ...['table.insert', 'table.concat', 'math.max', 'math.min', 'camera.screen_to_world', 'html5.run', 'sys.get_config_string', 'b2d.body.get_position'].map((n) => el(n)),
  el('go.EASING', 'ENUM', 'runtime', [
    { name: 'go.EASING_LINEAR', doc: '', type: '' },
    { name: 'go.EASING_OUTBACK', doc: '', type: '' },
  ]),
  el('go.PLAYBACK_ONCE_FORWARD', 'CONSTANT'),
  el('unpack'),
  el('pprint'),
  el('message.physics.trigger_info', 'STRUCT'),
  el('editor.get', 'FUNCTION', 'editor'),
];
const NAMES = apiNames(ELEMENTS, [], '9.9.9');

/** Validate `targets` (default: every file) of an in-memory project and return the unknown-api findings. */
async function check(files: Record<string, string>, options: { targets?: string[]; libraries?: Record<string, string>; names?: ApiNames } = {}): Promise<Issue[]> {
  const checker = new CrossChecker({
    readText: async (r) => files[r],
    inputBinding: '/input/game.input_binding',
    luaFiles: async () => Object.keys(files).filter((r) => LUA_EXTENSIONS.test(r)),
    apiNames: async () => options.names ?? NAMES,
    libraryLua: async () => new Map(Object.entries(options.libraries ?? {})),
  });
  for (const r of options.targets ?? Object.keys(files)) checkFile(r, files[r]!, checker.taps(r));
  return (await checker.finish()).filter((i) => i.rule === 'unknown-api');
}

const lines = (issues: Issue[]) => issues.map((i) => `${i.line}: ${i.message}`);
/** Line and member of each finding. */
const found = (issues: Issue[]) => issues.map((i) => `${i.line} ${i.message.split(' ')[0]}`);
const init = (body: string) => `function init(self)\n${body}\nend\n`;

describe('unknown API members', () => {
  it('flags functions and constants the API does not have, with the likely fix', async () => {
    const issues = await check({
      '/main/hero.script': init(
        [
          '  go.set_visible(".", true)',
          '  sprite.play_animation("#sprite", hash("run"))',
          '  local a, b = table.unpack({1, 2})',
          '  go.animate(".", "position.y", go.PLAYBACK_ONCE_FORWARD, 10, go.EASING_OUTBAK, 1)',
          '  local p = go.get_world_postion()',
        ].join('\n'),
      ),
    });
    expect(lines(issues)).toEqual([
      '2: go.set_visible does not exist in Defold 9.9.9 and nothing in the project defines it, so it is nil at runtime (the api tool lists what exists: namespace=go)',
      '3: sprite.play_animation does not exist in Defold 9.9.9 and nothing in the project defines it, so it is nil at runtime (similar: sprite.play_flipbook)',
      '4: table.unpack does not exist in Defold 9.9.9 and nothing in the project defines it, so it is nil at runtime — did you mean the global unpack?',
      '5: go.EASING_OUTBAK does not exist in Defold 9.9.9 and nothing in the project defines it, so it is nil at runtime — did you mean go.EASING_OUTBACK?',
      '6: go.get_world_postion does not exist in Defold 9.9.9 and nothing in the project defines it, so it is nil at runtime — did you mean go.get_world_position?',
    ]);
    expect(issues[0]).toMatchObject({ severity: 'warning', resource: '/main/hero.script', column: 3 });
  });

  it('accepts documented members, enum values, nested tables and members the engine has without documenting them', async () => {
    const code = init('  go.animate(".", "position", go.PLAYBACK_ONCE_FORWARD, vmath.vector3(), go.EASING_LINEAR, 1)\n  local p = b2d.body.get_position(body)\n  local r = math.mod(7, 2)\n  msg.post(".", "x")');
    expect(await check({ '/a.script': code })).toEqual([]);
  });

  it('leaves locals and parameters that share a name with an API table alone', async () => {
    const issues = await check({
      '/a.script':
        'local camera = require "lib.camera"\ncamera.follow(".")\n' +
        'local function f(sound, timer)\n  sound.play_music()\n  for _, msg in ipairs({}) do msg.send() end\n  return timer.after(1)\nend\n' +
        'local function g()\n  local table = {}\n  table.anything()\nend\n' +
        'table.anything()\n',
    });
    expect(found(issues)).toEqual(['12 table.anything']);
  });

  it('allows members the project adds itself, in any file or library', async () => {
    const files = {
      '/utils/mathx.lua': 'function math.clamp(v, lo, hi) return math.max(lo, math.min(hi, v)) end\nmath.round = function(v) return math.floor(v + 0.5) end\n_G.table.shallow_copy = function(t) return t end\nreturn {}\n',
      '/utils/compat.lua': 'table.unpack = table.unpack or unpack\nlocal new = require "table.new"\nreturn {}\n',
      '/main/hero.script': init('  local v = math.clamp(math.round(1.4), 0, 1)\n  local t = table.shallow_copy(table.new(4, 0))\n  local a = table.unpack({})\n  go.custom_helper()'),
    };
    const libraries = { '/lib/ext.lua': 'function go.custom_helper() end\nreturn {}\n' };
    // Only the script is validated; the definitions come from the rest of the project and a library.
    expect(await check(files, { targets: ['/main/hero.script'], libraries })).toEqual([]);
    expect(lines(await check(files, { targets: ['/main/hero.script'] }))).toEqual([expect.stringContaining('go.custom_helper does not exist')]);
  });

  it('skips tables the project replaces, writes with computed keys or hands around', async () => {
    const issues = await check({
      '/a.lua': 'camera = require "lib.camera"\nlocal g = go\ng.helper = 1\nfor k, v in pairs({}) do sys[k] = v end\nsetmetatable(msg, {})\nreturn {}\n',
      '/b.script': init('  camera.follow(".")\n  go.helper()\n  sys.anything()\n  msg.whatever()\n  if html5 then html5.call() end'),
    });
    expect(issues).toEqual([]);
  });

  it('treats a member tested for existence as possibly present', async () => {
    const code =
      'local unpack = table.unpack or unpack\n' +
      'if sys.get_config then print(sys.get_config("x")) end\n' +
      'if type(go.exists) == "function" and go.exists(".") then end\n' +
      'if go.newer_api ~= nil then go.newer_api() end\n' +
      'local f = not sprite.play_animation and sprite.play_flipbook\n';
    expect(await check({ '/a.script': code })).toEqual([]);
  });

  it('skips editor scripts, tables a native extension documents, unknown tables and describe-only entries', async () => {
    const files = {
      '/e.editor_script': 'local M = {}\nfunction M.get_commands() go.set_visible() return { editor.get("/x", "y") } end\nreturn M\n',
      '/a.script': init('  camera.follow(".")\n  defos.set_fullscreen(true)\n  local d = message.physics'),
    };
    expect(await check(files, { names: apiNames(ELEMENTS, [el('camera.follow')], '9.9.9') })).toEqual([]);
    // Without the extension the camera table is the built-in one.
    expect(found(await check(files))).toEqual(['2 camera.follow']);
  });

  it('stays quiet without the API reference, and reads it and the rest of the project only when needed', async () => {
    expect(await check({ '/a.script': init('  go.set_visible()') }, { names: undefined as unknown as ApiNames })).toHaveLength(1);
    const asked = { names: 0, others: 0 };
    const sources = (names: ApiNames | undefined) => ({
      names: async () => (asked.names++, names),
      others: async () => (asked.others++, []),
    });
    const scan = (code: string) => new Map([['/a.script', scanLuaText(code, '/a.script')!]]);
    expect(await unknownApiIssues(scan(init('  go.set_visible()')), sources(undefined))).toEqual([]);
    expect(await unknownApiIssues(scan(init('  local x = 1')), sources(NAMES))).toEqual([]);
    expect(await unknownApiIssues(scan(init('  go.animate()')), sources(NAMES))).toEqual([]);
    expect(asked).toEqual({ names: 2, others: 0 });
    expect(await unknownApiIssues(scan(init('  go.animatee()')), sources(NAMES))).toHaveLength(1);
    expect(asked.others).toBe(1);
  });

  it('derives the checked tables from functions, constants and enums', () => {
    expect([...NAMES.roots].sort()).toEqual(['b2d', 'camera', 'go', 'html5', 'math', 'msg', 'sprite', 'sys', 'table']);
    expect(NAMES.known.has('b2d.body')).toBe(true);
    expect(NAMES.known.has('go.EASING_OUTBACK')).toBe(true);
    expect(NAMES.globals.has('unpack')).toBe(true);
  });
});

describe('global member scan', () => {
  const scan = (code: string) => scanLuaText(code, '/a.script')!;

  it('records uses, definitions and globals whose members cannot be known', () => {
    const s = scan('go.animate()\nfunction go.extra() end\ngo:method()\n_G.sys = {}\nlocal r = go["x"]\nprint(vmath.vector3().x)\n');
    expect(s.uses.map((u) => u.name)).toEqual(['go.animate', 'vmath.vector3']);
    expect([...s.defines]).toEqual(['go.extra']);
    expect([...s.open].sort()).toEqual(['print', 'sys']);
  });

  it('does not parse a file with a syntax error', () => {
    expect(scanLuaText('function (', '/a.lua')).toBeUndefined();
  });
});
