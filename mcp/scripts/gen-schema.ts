// Generate src/ddf/schema.generated.json from Defold's .proto files at a pinned tag.
// Usage: npx tsx scripts/gen-schema.ts [tag=1.13.2]
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import protobuf from 'protobufjs';

const require = createRequire(import.meta.url);
const here = path.dirname(fileURLToPath(import.meta.url));
const tag = process.argv[2] ?? '1.13.2';
const cacheDir = path.join(here, '.proto-cache', tag);
const outFile = path.resolve(here, '../src/ddf/schema.generated.json');

const PROTOS = [
  'engine/ddf/src/ddf/ddf_extensions.proto',
  'engine/ddf/src/ddf/ddf_math.proto',
  'engine/ddf/src/ddf/ddf_struct.proto',
  'engine/gameobject/proto/gameobject/gameobject_ddf.proto',
  'engine/gameobject/proto/gameobject/properties_ddf.proto',
  'engine/gameobject/proto/gameobject/lua_ddf.proto',
  'engine/script/src/script/lua_source_ddf.proto',
  'engine/gamesys/proto/gamesys/atlas_ddf.proto',
  'engine/gamesys/proto/gamesys/buffer_ddf.proto',
  'engine/gamesys/proto/gamesys/camera_ddf.proto',
  'engine/gamesys/proto/gamesys/collectionproxy_ddf.proto',
  'engine/gamesys/proto/gamesys/data_ddf.proto',
  'engine/gamesys/proto/gamesys/gamesys_ddf.proto',
  'engine/gamesys/proto/gamesys/gui_ddf.proto',
  'engine/gamesys/proto/gamesys/label_ddf.proto',
  'engine/gamesys/proto/gamesys/mesh_ddf.proto',
  'engine/gamesys/proto/gamesys/model_ddf.proto',
  'engine/gamesys/proto/gamesys/physics_ddf.proto',
  'engine/gamesys/proto/gamesys/sound_ddf.proto',
  'engine/gamesys/proto/gamesys/sprite_ddf.proto',
  'engine/gamesys/proto/gamesys/texture_set_ddf.proto',
  'engine/gamesys/proto/gamesys/tile_ddf.proto',
  'engine/graphics/proto/graphics/graphics_ddf.proto',
  'engine/input/proto/input/input_ddf.proto',
  'engine/particle/proto/particle/particle_ddf.proto',
  'engine/render/proto/render/compute_ddf.proto',
  'engine/render/proto/render/font_ddf.proto',
  'engine/render/proto/render/material_ddf.proto',
  'engine/render/proto/render/render_ddf.proto',
  'engine/render/proto/render/render_target_ddf.proto',
  'engine/rig/proto/rig/rig_ddf.proto',
  'engine/font/proto/font/glyphbank_ddf.proto',
];

/** Resource file extension → protobuf message (what bob/the editor parse each file as). */
const EXTENSIONS: Record<string, string> = {
  collection: 'dmGameObjectDDF.CollectionDesc',
  go: 'dmGameObjectDDF.PrototypeDesc',
  sprite: 'dmGameSystemDDF.SpriteDesc',
  label: 'dmGameSystemDDF.LabelDesc',
  collisionobject: 'dmPhysicsDDF.CollisionObjectDesc',
  convexshape: 'dmPhysicsDDF.ConvexShape',
  factory: 'dmGameSystemDDF.FactoryDesc',
  collectionfactory: 'dmGameSystemDDF.CollectionFactoryDesc',
  collectionproxy: 'dmCollectionProxyDDF.CollectionProxyDesc',
  sound: 'dmSoundDDF.SoundDesc',
  camera: 'dmGamesysDDF.CameraDesc',
  gui: 'dmGuiDDF.SceneDesc',
  atlas: 'dmGameSystemDDF.Atlas',
  tilesource: 'dmGameSystemDDF.TileSet',
  tileset: 'dmGameSystemDDF.TileSet',
  tilemap: 'dmGameSystemDDF.TileGrid',
  tilegrid: 'dmGameSystemDDF.TileGrid',
  particlefx: 'dmParticleDDF.ParticleFX',
  font: 'dmRenderDDF.FontDesc',
  material: 'dmRenderDDF.MaterialDesc',
  compute: 'dmRenderDDF.ComputeDesc',
  render: 'dmRenderDDF.RenderPrototypeDesc',
  render_target: 'dmRenderDDF.RenderTargetDesc',
  display_profiles: 'dmRenderDDF.DisplayProfiles',
  input_binding: 'dmInputDDF.InputBinding',
  gamepads: 'dmInputDDF.GamepadMaps',
  texture_profiles: 'dmGraphics.TextureProfiles',
  model: 'dmModelDDF.ModelDesc',
  mesh: 'dmMeshDDF.MeshDesc',
  animationset: 'dmRigDDF.AnimationSetDesc',
  cubemap: 'dmGraphics.Cubemap',
  data: 'dmGameSystemDDF.Data',
  point_light: 'dmGameSystemDDF.Data',
  spot_light: 'dmGameSystemDDF.Data',
  directional_light: 'dmGameSystemDDF.Data',
  ambient_light: 'dmGameSystemDDF.Data',
};

/** Fields whose string value is itself a text-format document of another message. */
const EMBEDDED_DATA = {
  'dmGameObjectDDF.EmbeddedInstanceDesc.data': { message: 'dmGameObjectDDF.PrototypeDesc' },
  'dmGameObjectDDF.EmbeddedComponentDesc.data': { byTypeField: 'type' },
};

async function download(): Promise<void> {
  fs.mkdirSync(cacheDir, { recursive: true });
  for (const p of PROTOS) {
    const dest = path.join(cacheDir, p);
    if (fs.existsSync(dest)) continue;
    const url = `https://raw.githubusercontent.com/defold/defold/${tag}/${p}`;
    const res = await fetch(url);
    if (!res.ok) throw new Error(`${url}: HTTP ${res.status}`);
    fs.mkdirSync(path.dirname(dest), { recursive: true });
    fs.writeFileSync(dest, await res.text());
  }
}

function resolveImport(target: string): string | null {
  if (target.startsWith('google/protobuf/')) return require.resolve(`protobufjs/${target}`);
  if (path.isAbsolute(target) && fs.existsSync(target)) return target;
  const [first, ...rest] = target.split('/');
  const candidates = [
    path.join(cacheDir, 'engine', first!, 'proto', target),
    path.join(cacheDir, 'engine', first!, 'src', target),
    path.join(cacheDir, 'engine', 'ddf', 'src', target),
    path.join(cacheDir, 'engine', first!, 'proto', first!, ...rest),
  ];
  return candidates.find((c) => fs.existsSync(c)) ?? null;
}

interface FieldOut {
  name: string;
  number: number;
  label: 'required' | 'optional' | 'repeated';
  type: string;
  kind: 'scalar' | 'enum' | 'message';
  default?: string | number | boolean;
  resource?: true;
  runtimeOnly?: true;
}

await download();
const root = new protobuf.Root();
root.resolvePath = (_origin, target) => resolveImport(target) ?? target;
root.loadSync(PROTOS.map((p) => path.join(cacheDir, p)), { keepCase: true });
root.resolveAll();

const messages: Record<string, { fields: FieldOut[] }> = {};
const enums: Record<string, { values: Array<{ name: string; number: number; displayName?: string }> }> = {};
const packages = new Set<string>();

const visit = (ns: protobuf.NamespaceBase) => {
  for (const nested of ns.nestedArray) {
    if (nested instanceof protobuf.Type) {
      const full = nested.fullName.replace(/^\./, '');
      packages.add(full.split('.')[0]!);
      const fields: FieldOut[] = nested.fieldsArray
        .slice()
        .sort((a, b) => a.id - b.id)
        .map((f) => {
          f.resolve();
          if (f instanceof protobuf.MapField) {
            // Text format writes map entries as repeated `{ key: … value: … }` messages.
            const entryName = `${full}.${f.name}__Entry`;
            const vt = f.resolvedType;
            messages[entryName] = {
              fields: [
                { name: 'key', number: 1, label: 'optional', type: f.keyType, kind: 'scalar' },
                {
                  name: 'value',
                  number: 2,
                  label: 'optional',
                  type: vt ? vt.fullName.replace(/^\./, '') : f.type,
                  kind: vt instanceof protobuf.Enum ? 'enum' : vt instanceof protobuf.Type ? 'message' : 'scalar',
                },
              ],
            };
            return { name: f.name, number: f.id, label: 'repeated', type: entryName, kind: 'message' } as FieldOut;
          }
          const rt = f.resolvedType;
          const kind: FieldOut['kind'] = rt instanceof protobuf.Enum ? 'enum' : rt instanceof protobuf.Type ? 'message' : 'scalar';
          const type = rt ? rt.fullName.replace(/^\./, '') : f.type;
          const out: FieldOut = {
            name: f.name,
            number: f.id,
            label: f.repeated ? 'repeated' : f.required ? 'required' : 'optional',
            type,
            kind,
          };
          const opts = (f.options ?? {}) as Record<string, unknown>;
          if (opts.default !== undefined) out.default = opts.default as string | number | boolean;
          if (opts['(resource)'] === true) out.resource = true;
          if (opts['(runtime_only)'] === true) out.runtimeOnly = true;
          return out;
        });
      messages[full] = { fields };
      visit(nested);
    } else if (nested instanceof protobuf.Enum) {
      const full = nested.fullName.replace(/^\./, '');
      const valuesOptions = (nested as unknown as { valuesOptions?: Record<string, Record<string, unknown>> }).valuesOptions ?? {};
      enums[full] = {
        values: Object.entries(nested.values).map(([name, number]) => {
          const dn = valuesOptions[name]?.['(displayName)'];
          return dn ? { name, number, displayName: String(dn) } : { name, number };
        }),
      };
    } else if (nested instanceof protobuf.Namespace) {
      visit(nested);
    }
  }
};
visit(root);

const missing = Object.entries(EXTENSIONS).filter(([, m]) => !messages[m]);
if (missing.length) {
  console.error('Unknown messages for extensions:', missing);
  console.error('Packages:', [...packages].sort().join(', '));
  for (const pkg of packages) console.error(pkg, Object.keys(messages).filter((m) => m.startsWith(pkg + '.') && /Desc$|Set$|Grid$|FX$|Profiles$|Binding$|Maps$|Atlas$|Data$|Cubemap$/.test(m)).join(' '));
  process.exit(1);
}

const embeddedTypes: Record<string, string> = {};
for (const ext of ['sprite', 'label', 'collisionobject', 'factory', 'collectionfactory', 'collectionproxy', 'sound', 'camera', 'particlefx', 'tilemap', 'tilegrid', 'model', 'mesh', 'gui']) {
  embeddedTypes[ext] = EXTENSIONS[ext]!;
}

const out = { defoldVersion: tag, extensions: EXTENSIONS, embeddedTypes, embeddedData: EMBEDDED_DATA, messages, enums };
fs.writeFileSync(outFile, JSON.stringify(out));
console.log(`wrote ${outFile}: ${Object.keys(messages).length} messages, ${Object.keys(enums).length} enums (${(fs.statSync(outFile).size / 1024).toFixed(0)} KB)`);
