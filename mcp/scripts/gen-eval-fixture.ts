// Write the Defold projects used by project-based eval cases:
// - plugins/defold/evals/_fixtures/basic          the start project every project case copies
// - plugins/defold/evals/_fixtures/<overlay>      extra/changed files a case copies on top of basic
// - mcp/test/fixtures/eval-reference/<case>       a correct solution per case (kept outside the plugin so the
//                                                 evaluated agent cannot find it); test/unit/eval-graders.test.ts
//                                                 checks that the graders accept it and reject the start state.
// Usage: npx tsx scripts/gen-eval-fixture.ts
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import { fileURLToPath } from 'node:url';
import { printDocument, type JsonObject } from '../src/ddf/codec.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const fixtures = path.resolve(here, '../../plugins/defold/evals/_fixtures');
const references = path.resolve(here, '../test/fixtures/eval-reference');

function writer(root: string) {
  fs.rmSync(root, { recursive: true, force: true });
  return (rel: string, data: string | Buffer) => {
    const p = path.join(root, rel);
    fs.mkdirSync(path.dirname(p), { recursive: true });
    fs.writeFileSync(p, data);
  };
}

/** Minimal RGBA PNG of a solid colour with a darker border. */
function png(size: number, rgb: [number, number, number]): Buffer {
  const raw = Buffer.alloc((size * 4 + 1) * size);
  for (let y = 0; y < size; y++) {
    raw[y * (size * 4 + 1)] = 0;
    for (let x = 0; x < size; x++) {
      const border = x < 2 || y < 2 || x >= size - 2 || y >= size - 2;
      const o = y * (size * 4 + 1) + 1 + x * 4;
      raw[o] = border ? rgb[0] >> 1 : rgb[0];
      raw[o + 1] = border ? rgb[1] >> 1 : rgb[1];
      raw[o + 2] = border ? rgb[2] >> 1 : rgb[2];
      raw[o + 3] = 255;
    }
  }
  const crcTable = Array.from({ length: 256 }, (_, n) => {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    return c >>> 0;
  });
  const crc = (buf: Buffer) => {
    let c = 0xffffffff;
    for (const b of buf) c = crcTable[(c ^ b) & 0xff]! ^ (c >>> 8);
    return (c ^ 0xffffffff) >>> 0;
  };
  const chunk = (type: string, data: Buffer) => {
    const len = Buffer.alloc(4);
    len.writeUInt32BE(data.length);
    const td = Buffer.concat([Buffer.from(type), data]);
    const c = Buffer.alloc(4);
    c.writeUInt32BE(crc(td));
    return Buffer.concat([len, td, c]);
  };
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8;
  ihdr[9] = 6;
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', ihdr), chunk('IDAT', zlib.deflateSync(raw)), chunk('IEND', Buffer.alloc(0))]);
}

const COLLECTION = 'dmGameObjectDDF.CollectionDesc';
const PROTOTYPE = 'dmGameObjectDDF.PrototypeDesc';
const GUI = 'dmGuiDDF.SceneDesc';
const doc = (json: Record<string, unknown>, type: string) => printDocument(json as JsonObject, type, { docLevel: 0 });

const sprite = (animation: string, extra: Record<string, unknown> = {}) => ({
  id: 'sprite',
  type: 'sprite',
  data: { default_animation: animation, material: '/builtins/materials/sprite.material', textures: [{ sampler: 'texture_sampler', texture: '/main/sprites.atlas' }] },
  ...extra,
});
const collisionObject = (type: string, group: string, mask: string, half: number) => ({
  id: 'collisionobject',
  type: 'collisionobject',
  data: {
    collision_shape: '',
    type,
    mass: 0,
    friction: 0.1,
    restitution: 0.5,
    group,
    mask,
    embedded_collision_shape: { shapes: [{ shape_type: 'TYPE_BOX', position: {}, rotation: {}, index: 0, count: 3 }], data: [half, half, 10] },
  },
});
const player = (extraComponents: unknown[] = []) => ({
  id: 'player',
  data: { components: [{ id: 'player', component: '/main/player.script' }], embedded_components: [sprite('hero'), ...extraComponents] },
  position: { x: 320, y: 200 },
});
const mainCollection = (instances: unknown[], extra: Record<string, unknown> = {}) =>
  doc({ name: 'main', scale_along_z: 0, ...extra, embedded_instances: instances }, COLLECTION);
const PLAYER_SCRIPT = 'go.property("speed", 200)\n\nfunction init(self)\n\tmsg.post(".", "acquire_input_focus")\nend\n\nfunction on_input(self, action_id, action)\nend\n';
const INPUT_BINDING = 'key_trigger {\n  input: KEY_LEFT\n  action: "left"\n}\nkey_trigger {\n  input: KEY_RIGHT\n  action: "right"\n}\nmouse_trigger {\n  input: MOUSE_BUTTON_1\n  action: "touch"\n}\n';

// ---------------------------------------------------------------------------------------------------- basic
{
  const write = writer(path.join(fixtures, 'basic'));
  write('game.project', '[project]\ntitle = Eval Game\n\n[bootstrap]\nmain_collection = /main/main.collectionc\n\n[input]\ngame_binding = /input/game.input_bindingc\n\n[display]\nwidth = 640\nheight = 960\n\n[physics]\ngravity_y = -1000.0\nscale = 0.01\n');
  write('.gitignore', '/build\n/.internal\n/.editor_settings\n');
  write('assets/hero.png', png(64, [60, 160, 230]));
  write('assets/coin.png', png(32, [240, 200, 40]));
  write('main/sprites.atlas', 'images {\n  image: "/assets/hero.png"\n}\nimages {\n  image: "/assets/coin.png"\n}\nextrude_borders: 2\n');
  write('input/game.input_binding', INPUT_BINDING);
  write('main/player.script', PLAYER_SCRIPT);
  write('main/main.collection', mainCollection([player()]));
}

// ------------------------------------------------------------------ spawner-runtime-bugs (overlay + reference)
// Two bugs that only show at runtime: init passes a local function that is declared later (so it is still a nil
// global when init runs), and the enemy sprite sits at z 3, outside the default render's visible -1..1 range.
const SPAWNER_FIXED = `go.property("interval", 1)

local function spawn_enemy(self, handle, time_elapsed)
\tlocal x = math.random(40, 600)
\tfactory.create("#enemy_factory", vmath.vector3(x, 1000, 0))
end

function init(self)
\tmath.randomseed(os.time())
\tself.timer = timer.delay(self.interval, true, spawn_enemy)
end
`;
const SPAWNER_BUGGY = `go.property("interval", 1)

function init(self)
\tmath.randomseed(os.time())
\tself.timer = timer.delay(self.interval, true, spawn_enemy)
end

local function spawn_enemy(self, handle, time_elapsed)
\tlocal x = math.random(40, 600)
\tfactory.create("#enemy_factory", vmath.vector3(x, 1000, 0))
end
`;
const ENEMY_SCRIPT = `go.property("speed", 250)

function init(self)
\tprint("enemy spawned")
end

function update(self, dt)
\tlocal p = go.get_position()
\tp.y = p.y - self.speed * dt
\tif p.y < -50 then
\t\tgo.delete()
\telse
\t\tgo.set_position(p)
\tend
end
`;
const enemyGo = (z: number | undefined) =>
  doc({ components: [{ id: 'enemy', component: '/main/enemy.script' }], embedded_components: [sprite('coin', z === undefined ? {} : { position: { z } })] }, PROTOTYPE);
const spawnerCollection = mainCollection([
  player(),
  {
    id: 'spawner',
    data: {
      components: [{ id: 'spawner', component: '/main/spawner.script' }],
      embedded_components: [{ id: 'enemy_factory', type: 'factory', data: { prototype: '/main/enemy.go' } }],
    },
  },
]);
{
  const write = writer(path.join(fixtures, 'spawner-bugs'));
  write('main/spawner.script', SPAWNER_BUGGY);
  write('main/enemy.script', ENEMY_SCRIPT);
  write('main/enemy.go', enemyGo(3));
  write('main/main.collection', spawnerCollection);
}
{
  const write = writer(path.join(references, 'spawner-runtime-bugs'));
  write('main/spawner.script', SPAWNER_FIXED);
  write('main/enemy.go', enemyGo(undefined));
}

// ---------------------------------------------------------------------- level-scene-edit (overlay + reference)
const level = (edit: boolean) =>
  doc(
    {
      name: 'level',
      scale_along_z: 0,
      embedded_instances: [1, 2, 3, 4, 5].map((n) => ({
        id: `enemy_${n}`,
        data: {
          embedded_components: [
            sprite(edit && n === 3 ? 'coin' : 'hero'),
            edit ? collisionObject('COLLISION_OBJECT_TYPE_KINEMATIC', 'enemy', 'player', 32) : collisionObject('COLLISION_OBJECT_TYPE_KINEMATIC', 'default', 'default', 32),
          ],
        },
        position: { x: edit && n === 5 ? 560 : n * 100, y: 700 },
      })),
    },
    COLLECTION,
  );
{
  const write = writer(path.join(fixtures, 'level-edit'));
  write('main/level.collection', level(false));
  write('main/main.collection', mainCollection([player()], { collection_instances: [{ id: 'level', collection: '/main/level.collection' }] }));
}
{
  const write = writer(path.join(references, 'level-scene-edit'));
  write('main/level.collection', level(true));
}

// ---------------------------------------------------------------------------- coin-trigger-listener (reference)
{
  const write = writer(path.join(references, 'coin-trigger-listener'));
  write(
    'main/main.collection',
    mainCollection([
      player([collisionObject('COLLISION_OBJECT_TYPE_KINEMATIC', 'player', 'coin', 32)]),
      { id: 'coin', data: { embedded_components: [sprite('coin'), collisionObject('COLLISION_OBJECT_TYPE_TRIGGER', 'coin', 'player', 16)] }, position: { x: 320, y: 220 } },
    ]),
  );
  write(
    'main/player.script',
    `go.property("speed", 200)

local TRIGGER_EVENT = hash("trigger_event")
local COIN = hash("coin")

local function on_physics(self, events)
\tfor _, event in ipairs(events) do
\t\tif event.type == TRIGGER_EVENT and event.enter then
\t\t\tlocal coin = event.a.group == COIN and event.a or event.b
\t\t\tif coin.group == COIN then
\t\t\t\tgo.delete(coin.id)
\t\t\t\tprint("collected")
\t\t\tend
\t\tend
\tend
end

function init(self)
\tmsg.post(".", "acquire_input_focus")
\tphysics.set_event_listener(on_physics)
end

function on_input(self, action_id, action)
end
`,
  );
}

// --------------------------------------------------------------------------------------- pause-menu (reference)
{
  const write = writer(path.join(references, 'pause-menu'));
  const box = (id: string, x: number, y: number, w: number, h: number, extra: Record<string, unknown> = {}) => ({
    position: { x, y },
    size: { x: w, y: h },
    type: 'TYPE_BOX',
    id,
    ...extra,
  });
  const text = (id: string, label: string, parent: string, y = 0) => ({
    position: { y },
    size: { x: 200, y: 40 },
    type: 'TYPE_TEXT',
    text: label,
    font: 'default',
    id,
    parent,
  });
  write(
    'main/pause.gui',
    doc(
      {
        script: '/main/pause.gui_script',
        fonts: [{ name: 'default', font: '/builtins/fonts/default.font' }],
        nodes: [
          box('panel', 320, 480, 400, 320, { color: { x: 0.05, y: 0.05, z: 0.1 }, alpha: 0.8 }),
          text('title', 'Paused', 'panel', 110),
          box('resume', 0, 10, 220, 60, { parent: 'panel', color: { x: 0.2, y: 0.5, z: 0.3 } }),
          text('resume_label', 'Resume', 'resume'),
          box('quit', 0, -80, 220, 60, { parent: 'panel', color: { x: 0.5, y: 0.2, z: 0.2 } }),
          text('quit_label', 'Quit', 'quit'),
        ],
      },
      GUI,
    ),
  );
  write(
    'main/pause.gui_script',
    `local PAUSE = hash("pause")
local TOUCH = hash("touch")

local function show(self, visible)
\tself.visible = visible
\tgui.set_enabled(gui.get_node("panel"), visible)
end

function init(self)
\tmsg.post(".", "acquire_input_focus")
\tshow(self, false)
end

function on_input(self, action_id, action)
\tif action_id == PAUSE and action.pressed then
\t\tshow(self, not self.visible)
\t\treturn true
\tend
\tif not self.visible then
\t\treturn false
\tend
\tif action_id == TOUCH and action.pressed then
\t\tif gui.pick_node(gui.get_node("resume"), action.x, action.y) then
\t\t\tshow(self, false)
\t\telseif gui.pick_node(gui.get_node("quit"), action.x, action.y) then
\t\t\tmsg.post("@system:", "exit", { code = 0 })
\t\tend
\tend
\t-- While the menu is open it consumes all input, so the player does not react.
\treturn true
end
`,
  );
  write('input/game.input_binding', INPUT_BINDING.replace('mouse_trigger', 'key_trigger {\n  input: KEY_ESC\n  action: "pause"\n}\nmouse_trigger'));
  write('main/main.collection', mainCollection([player(), { id: 'ui', data: { components: [{ id: 'pause', component: '/main/pause.gui' }] } }]));
}

console.log(`wrote fixtures to ${fixtures} and references to ${references}`);
