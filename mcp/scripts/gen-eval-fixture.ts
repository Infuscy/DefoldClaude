// Write the small Defold project used by project-based eval cases (plugins/defold/evals/_fixtures/basic).
// Usage: npx tsx scripts/gen-eval-fixture.ts
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import { fileURLToPath } from 'node:url';
import { printDocument } from '../src/ddf/codec.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '../../plugins/defold/evals/_fixtures/basic');
const write = (rel: string, data: string | Buffer) => {
  const p = path.join(root, rel);
  fs.mkdirSync(path.dirname(p), { recursive: true });
  fs.writeFileSync(p, data);
};

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

fs.rmSync(root, { recursive: true, force: true });
write('game.project', '[project]\ntitle = Eval Game\n\n[bootstrap]\nmain_collection = /main/main.collectionc\n\n[input]\ngame_binding = /input/game.input_bindingc\n\n[display]\nwidth = 640\nheight = 960\n\n[script]\nshared_state = 1\n\n[physics]\ngravity_y = -1000.0\nscale = 0.01\n');
write('.gitignore', '/build\n/.internal\n/.editor_settings\n');
write('assets/hero.png', png(64, [60, 160, 230]));
write('assets/coin.png', png(32, [240, 200, 40]));
write('main/sprites.atlas', 'images {\n  image: "/assets/hero.png"\n}\nimages {\n  image: "/assets/coin.png"\n}\nextrude_borders: 2\n');
write('input/game.input_binding', 'key_trigger {\n  input: KEY_LEFT\n  action: "left"\n}\nkey_trigger {\n  input: KEY_RIGHT\n  action: "right"\n}\nmouse_trigger {\n  input: MOUSE_BUTTON_1\n  action: "touch"\n}\n');
write('main/player.script', 'go.property("speed", 200)\n\nfunction init(self)\n\tmsg.post(".", "acquire_input_focus")\nend\n\nfunction on_input(self, action_id, action)\nend\n');
const collection = printDocument(
  {
    name: 'main',
    scale_along_z: 0,
    embedded_instances: [
      {
        id: 'player',
        data: {
          components: [{ id: 'player', component: '/main/player.script' }],
          embedded_components: [{ id: 'sprite', type: 'sprite', data: { default_animation: 'hero', material: '/builtins/materials/sprite.material', textures: [{ sampler: 'texture_sampler', texture: '/main/sprites.atlas' }] } }],
        },
        position: { x: 320, y: 200 },
      },
    ],
  },
  'dmGameObjectDDF.CollectionDesc',
  { docLevel: 0 },
);
write('main/main.collection', collection);
console.log(`wrote fixture to ${root}`);
