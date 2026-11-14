// Cross-file checks: each case is a mistake that passes the per-file checks and fails quietly in the game.
import { describe, expect, it } from 'vitest';
import { checkFile, LUA_EXTENSIONS } from '../../src/ddf/checkfile.js';
import { encodeEmbeddedLiteral } from '../../src/ddf/codec.js';
import { animationIds, boundActions, CrossChecker, inputBindingPath } from '../../src/ddf/crosscheck.js';
import { BUILTIN_MESSAGES, misspelledBuiltin } from '../../src/lua/names.js';
import type { Issue } from '../../src/runtime/issues.js';
import { parseIni } from '../../src/util/ini.js';

const ATLAS = 'images {\n  image: "/img/coin.png"\n}\nanimations {\n  id: "idle"\n  images {\n    image: "/img/a.png"\n  }\n}\nanimations {\n  id: "run"\n  images {\n    image: "/img/b.png"\n  }\n}\n';
const BINDING = 'key_trigger {\n  input: KEY_SPACE\n  action: "jump"\n}\nmouse_trigger {\n  input: MOUSE_BUTTON_LEFT\n  action: "touch"\n}\n';
const sprite = (animation: string, atlas = '/main/hero.atlas') => `default_animation: "${animation}"\ntextures {\n  sampler: "texture_sampler"\n  texture: "${atlas}"\n}\n`;
const onInput = (body: string) => `function on_input(self, action_id, action)\n${body}\nend\n`;
const onMessage = (body: string) => `function on_message(self, message_id, message, sender)\n${body}\nend\n`;

/** Validate `targets` (default: every file) of an in-memory project and return only the cross-file findings. */
async function cross(files: Record<string, string>, targets = Object.keys(files)): Promise<Issue[]> {
  const all: Record<string, string> = { '/main/hero.atlas': ATLAS, '/input/game.input_binding': BINDING, ...files };
  const checker = new CrossChecker({
    readText: async (r) => all[r],
    inputBinding: '/input/game.input_binding',
    luaFiles: async () => Object.keys(all).filter((r) => LUA_EXTENSIONS.test(r)),
  });
  for (const r of targets) checkFile(r, all[r]!, checker.taps(r));
  return checker.finish();
}

describe('animation names', () => {
  it('flags a sprite default_animation that its atlas does not have', async () => {
    const issues = await cross({ '/main/hero.sprite': sprite('runn') });
    expect(issues).toEqual([
      { severity: 'error', resource: '/main/hero.sprite', line: 1, rule: 'sprite-animation', message: 'default_animation "runn" is not an animation in /main/hero.atlas — did you mean "run"?' },
    ]);
  });

  it('accepts flipbook animations, standalone images and renamed images', async () => {
    const renamed = 'images {\n  image: "/img/hero_big.png"\n}\nrename_patterns: "_big=,hero=player"\n';
    const issues = await cross({
      '/a.sprite': sprite('idle'),
      '/b.sprite': sprite('coin'),
      '/c.sprite': sprite('player', '/main/renamed.atlas'),
      '/d.sprite': sprite('hero_big', '/main/renamed.atlas'),
      '/main/renamed.atlas': renamed,
    });
    expect(issues).toEqual([]);
  });

  it('lists what the atlas has when nothing is close', async () => {
    const [issue] = await cross({ '/a.sprite': sprite('explode') });
    expect(issue!.message).toBe('default_animation "explode" is not an animation in /main/hero.atlas (animations: coin, idle, run)');
  });

  it('checks tile sources and the older tile_set field', async () => {
    const issues = await cross({
      '/tiles.tilesource': 'image: "/img/tiles.png"\ntile_width: 16\ntile_height: 16\nanimations {\n  id: "walk"\n  start_tile: 1\n  end_tile: 4\n}\n',
      '/a.sprite': 'tile_set: "/tiles.tilesource"\ndefault_animation: "walk"\n',
      '/b.sprite': 'tile_set: "/tiles.tilesource"\ndefault_animation: "wlak"\n',
    });
    expect(issues.map((i) => `${i.resource} ${i.rule}`)).toEqual(['/b.sprite sprite-animation']);
  });

  it('finds sprites embedded in a collection and reports the line inside the embedded data', async () => {
    const components = `embedded_components {\n  id: "sprite"\n  type: "sprite"\n  data: ${encodeEmbeddedLiteral(sprite('jumping'), 1)}\n}\n`;
    const collection = `name: "main"\nembedded_instances {\n  id: "hero"\n  data: ${encodeEmbeddedLiteral(components, 0)}\n}\n`;
    const [issue, ...rest] = await cross({ '/main/main.collection': collection });
    expect(rest).toEqual([]);
    expect(issue).toMatchObject({ severity: 'error', rule: 'sprite-animation' });
    expect(issue!.message).toContain("(in embedded component 'sprite' in game object 'hero')");
    expect(collection.split('\n')[issue!.line! - 1]).toContain('default_animation');
  });

  it('skips atlases it cannot read and texture formats it does not know', async () => {
    const issues = await cross({ '/a.sprite': sprite('x', '/lib/missing.atlas'), '/b.sprite': sprite('x', '/main/hero.tpatlas'), '/main/hero.tpatlas': 'whatever', '/c.sprite': sprite('x', '/broken.atlas'), '/broken.atlas': 'images {' });
    expect(issues).toEqual([]);
  });

  it('flags a GUI node animation that the texture does not have', async () => {
    const gui =
      'textures {\n  name: "ui"\n  texture: "/main/hero.atlas"\n}\n' +
      'nodes {\n  type: TYPE_BOX\n  id: "ok"\n  texture: "ui/idle"\n}\n' +
      'nodes {\n  type: TYPE_BOX\n  id: "bad"\n  texture: "ui/idel"\n}\n' +
      'nodes {\n  type: TYPE_BOX\n  id: "from_template"\n  texture: "ui/nothing"\n  template_node_child: true\n}\n' +
      'layouts {\n  name: "Landscape"\n  nodes {\n    type: TYPE_BOX\n    id: "ok"\n    texture: "ui/gone"\n  }\n}\n';
    const issues = await cross({ '/main/hud.gui': gui });
    expect(issues.map((i) => [i.rule, i.line, i.message])).toEqual([
      ['gui-animation', 13, 'Node "bad" uses "ui/idel", but /main/hero.atlas has no animation "idel" — did you mean "idle"?'],
      ['gui-animation', 26, 'Node "ok" uses "ui/gone", but /main/hero.atlas has no animation "gone" (animations: coin, idle, run)'],
    ]);
  });

  it('flags a particle emitter animation that its tile source does not have', async () => {
    const pfx = (animation: string) =>
      `emitters {\n  id: "sparks"\n  mode: PLAY_MODE_ONCE\n  space: EMISSION_SPACE_WORLD\n  position {\n  }\n  rotation {\n  }\n  tile_source: "/main/hero.atlas"\n  animation: "${animation}"\n  material: "/builtins/materials/particlefx.material"\n  max_particle_count: 8\n  type: EMITTER_TYPE_CIRCLE\n}\n`;
    const issues = await cross({ '/fx/ok.particlefx': pfx('coin'), '/fx/bad.particlefx': pfx('coins') });
    expect(issues.map((i) => [i.resource, i.rule, i.line, i.message])).toEqual([
      ['/fx/bad.particlefx', 'particlefx-animation', 10, 'Emitter "sparks" plays animation "coins", which is not in /main/hero.atlas — did you mean "coin"?'],
    ]);
  });

  it('reads animation ids', () => {
    expect([...animationIds('/a.atlas', ATLAS)!].sort()).toEqual(['coin', 'idle', 'run']);
    expect(animationIds('/a.png', '')).toBeUndefined();
  });
});

describe('input actions', () => {
  it('flags an action_id comparison with an action the binding does not produce', async () => {
    const issues = await cross({ '/main/hero.script': onInput('  if action_id == hash("jmp") and action.pressed then end\n  if action_id == hash("jmp") then end') });
    expect(issues).toEqual([
      {
        severity: 'warning',
        resource: '/main/hero.script',
        line: 2,
        column: 24,
        rule: 'input-action',
        message: 'action_id is compared with hash("jmp"), but /input/game.input_binding binds nothing to "jmp", so this never matches — did you mean "jump"?',
      },
    ]);
  });

  it('follows local hash constants and a renamed on_input parameter', async () => {
    const issues = await cross({
      '/a.script': 'local FIRE = hash("fire")\nlocal JUMP = hash("jump")\n' + onInput('  if action_id == FIRE or JUMP == action_id then end'),
      '/b.gui_script': 'function on_input(self, id, action)\n  if id == hash("click") then end\nend\n',
    });
    expect(issues.map((i) => [i.resource, i.line, i.rule])).toEqual([
      ['/a.script', 1, 'input-action'],
      ['/b.gui_script', 2, 'input-action'],
    ]);
    expect(issues[1]!.message).toContain('(actions: jump, touch)');
  });

  it('accepts bound actions and stays quiet when the binding cannot be read', async () => {
    expect(await cross({ '/a.script': onInput('  if action_id == hash("touch") or action_id == hash("jump") then end') })).toEqual([]);
    const checker = new CrossChecker({ readText: async () => undefined, inputBinding: '/input/game.input_binding', luaFiles: async () => [] });
    checkFile('/a.script', onInput('  if action_id == hash("nope") then end'), checker.taps('/a.script'));
    expect(await checker.finish()).toEqual([]);
  });

  it('reads the binding path from game.project and the bound actions from the binding', () => {
    expect(inputBindingPath(parseIni('[input]\ngame_binding = /controls/all.input_bindingc\n'))).toBe('/controls/all.input_binding');
    expect(inputBindingPath(parseIni('[project]\ntitle = x\n'))).toBe('/input/game.input_binding');
    expect([...boundActions(BINDING)!]).toEqual(['jump', 'touch']);
  });
});

describe('message names', () => {
  it('flags a misspelled built-in message in on_message, written inline or as a constant', async () => {
    const issues = await cross({
      '/a.script': onMessage('  if message_id == hash("collision_respone") then end'),
      '/b.script': 'local TRIGGER = hash("trigger_respnose")\n' + onMessage('  if message_id == TRIGGER then end'),
    });
    expect(issues).toEqual([
      { severity: 'warning', resource: '/a.script', line: 2, column: 25, rule: 'message-name', message: '"collision_respone" is not a built-in message and nothing in the project posts it — did you mean "collision_response"?' },
      { severity: 'warning', resource: '/b.script', line: 1, column: 22, rule: 'message-name', message: '"trigger_respnose" is not a built-in message and nothing in the project posts it — did you mean "trigger_response"?' },
    ]);
  });

  it('flags a misspelled built-in message sent with msg.post', async () => {
    const issues = await cross({ '/a.script': 'function init(self)\n  msg.post(".", "aquire_input_focus")\n  msg.post("#sprite", hash("enabel"))\nend\n' });
    expect(issues.map((i) => [i.line, i.message])).toEqual([
      [2, '"aquire_input_focus" is not a built-in message and nothing in the project handles it — did you mean "acquire_input_focus"?'],
      [3, '"enabel" is not a built-in message and nothing in the project handles it — did you mean "enable"?'],
    ]);
  });

  it("leaves a game's own messages alone, even close to a built-in name", async () => {
    const issues = await cross({
      // Posted in one file, handled in another.
      '/a.script': 'function init(self)\n  msg.post("/hud", "set_pin")\nend\n',
      '/b.gui_script': onMessage('  if message_id == hash("set_pin") then end'),
      // Kept in a table of message ids that other files compare with.
      '/messages.lua': 'local M = {}\nM.PLAY_SOUNDS = hash("play_sounds2")\nreturn M\n',
      '/c.script': onMessage('  if message_id == hash("play_sounds2") then end'),
      // Inflections, short names, unrelated names and the built-ins themselves.
      '/d.script': onMessage('  if message_id == hash("enabled") or message_id == hash("hit") or message_id == hash("level_done") or message_id == hash("trigger_response") then end'),
      // A constant that is also used for something else is not known to be a message.
      '/e.script': 'local RESIZE = hash("resizee")\n' + onMessage('  if message_id == RESIZE then end') + 'function init(self)\n  self.state = RESIZE\nend\n',
    });
    expect(issues).toEqual([]);
  });

  it('looks at the whole project when only some files are validated', async () => {
    const files = { '/a.script': 'function init(self)\n  msg.post("/hud", "set_pin")\nend\n', '/b.gui_script': onMessage('  if message_id == hash("set_pin") then end') };
    expect(await cross(files, ['/b.gui_script'])).toEqual([]);
    expect((await cross({ '/b.gui_script': files['/b.gui_script'] })).map((i) => i.rule)).toEqual(['message-name']);
  });

  it('knows the built-in messages', () => {
    for (const name of ['collision_response', 'trigger_response', 'acquire_input_focus', 'enable', 'proxy_loaded', 'animation_done', 'set_parent']) expect(BUILTIN_MESSAGES.has(name), name).toBe(true);
    expect(misspelledBuiltin('contact_point_respose')).toBe('contact_point_response');
    expect(misspelledBuiltin('collision_response')).toBeUndefined();
    expect(misspelledBuiltin('loaded')).toBeUndefined();
  });
});

describe('without cross-file taps', () => {
  it('per-file checks report nothing new', () => {
    expect(checkFile('/a.sprite', sprite('nope'))).toEqual([]);
    expect(checkFile('/a.script', onInput('  if action_id == hash("nope") then end'))).toEqual([]);
  });
});
