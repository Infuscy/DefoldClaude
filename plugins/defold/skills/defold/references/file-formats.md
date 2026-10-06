# Defold resource file formats

Defold resources (everything except Lua, shaders, images, sounds and `game.project`) are protobuf **text format**.
The `edit_resource` tool reads and writes them for you and handles the escaping; use this page when you must
write or review the text yourself. `read_resource describe=true` lists every field of a type with its type,
default and allowed enum values.

## Rules of the format

- `field: value` per line, nested messages as `field { … }`, two-space indentation. Repeated fields repeat the
  field name (`images { … } images { … }`).
- Strings are double-quoted. Escapes are `\"`, `\\`, `\n` and `\t`. Non-ASCII characters are written as octal
  UTF-8 bytes by the editor (`"\303\245"` for å), and plain UTF-8 also parses.
- Adjacent string literals are concatenated: `"abc"` `"def"` equals `"abcdef"`. The editor splits strings after
  every `\n`, putting each piece on its own line with a two-space indent.
- Enum values are bare identifiers (`blend_mode: BLEND_MODE_ALPHA`). Booleans are `true`/`false`, but some legacy
  fields are integers 0/1 (`looping`, `is_visible`, `flip_horizontal`, `orthographic_projection`, `antialias`).
- Numbers: floats like `1.0`, `-0.5`, `8.7E-4`; integers like `2`.
- Fields equal to their default can be omitted (the editor omits them). Vectors default to 0 except scales
  (default 1) and quaternion `w` (default 1). So `position { x: 10.0 }` means (10, 0, 0).
- Resource references are project-absolute paths: `"/main/player.atlas"`, `"/builtins/materials/sprite.material"`.
- Field order is not significant to the parser. The editor writes fields in field-number order.
- File names can be anything; the extension decides the type.

## Embedded data (strings inside strings)

A collection can embed a whole game object, and a game object can embed a component. The embedded object is stored
as a **string** containing its own text format.

To embed text `T` in a `data:` field:
1. Write `T` with its normal indentation and a trailing newline.
2. Escape it: `\` → `\\`, `"` → `\"`, newline → `\n`.
3. Optionally split after each `\n` into separate `"…"` literals on their own lines, the last one followed by `""`.
   Splitting doesn't change the value.

An embedded component *inside* an embedded game object is escaped twice: `\"` becomes `\\\"` and `\n` becomes
`\\n`. This is where hand-edits usually break. Prefer `edit_resource`, which decodes this for you.

### Example: collection with an embedded game object holding a script and an embedded sprite

```
name: "main"
scale_along_z: 0
embedded_instances {
  id: "player"
  data: "components {\n"
  "  id: \"player\"\n"
  "  component: \"/main/player.script\"\n"
  "}\n"
  "embedded_components {\n"
  "  id: \"sprite\"\n"
  "  type: \"sprite\"\n"
  "  data: \"default_animation: \\\"idle\\\"\\n"
  "material: \\\"/builtins/materials/sprite.material\\\"\\n"
  "textures {\\n"
  "  sampler: \\\"texture_sampler\\\"\\n"
  "  texture: \\\"/main/main.atlas\\\"\\n"
  "}\\n"
  "\"\n"
  "}\n"
  ""
  position {
    x: 320.0
    y: 568.0
  }
}
```

The embedded game object's text (level 1) decodes to:

```
components {
  id: "player"
  component: "/main/player.script"
}
embedded_components {
  id: "sprite"
  type: "sprite"
  data: "default_animation: \"idle\"\nmaterial: \"/builtins/materials/sprite.material\"\ntextures {\n  sampler: \"texture_sampler\"\n  texture: \"/main/main.atlas\"\n}\n"
}
```

The sprite's text (level 2) decodes to a normal `.sprite` file (below).

## Collections and game objects

### `.collection`

```
name: "level1"                      # required; also the socket name if loaded via a collection proxy
instances {                          # game object from a .go file
  id: "enemy"
  prototype: "/main/enemy.go"
  children: "enemy_gun"              # ids of child instances in this collection
  position { x: 100.0 y: 50.0 }
  rotation { z: 0.38268343 w: 0.9238795 }     # quaternion
  scale3 { x: 2.0 y: 2.0 }
  component_properties {             # override script properties of this instance
    id: "enemy"                      # component id inside the game object
    properties { id: "speed" value: "80.0" type: PROPERTY_TYPE_NUMBER }
  }
}
collection_instances {               # nested collection
  id: "hud"
  collection: "/gui/hud.collection"
  position { z: 0.5 }
}
scale_along_z: 0
embedded_instances {                 # game object defined inline (see escaping above)
  id: "camera"
  data: "embedded_components {\n"
  "  id: \"camera\"\n"
  "  type: \"camera\"\n"
  "  data: \"orthographic_projection: 1\\n"
  "orthographic_mode: ORTHO_MODE_AUTO_COVER\\n"
  "\"\n"
  "}\n"
  ""
}
```

Script property override values are always strings. Use `"1.0"` (number), `"true"` (boolean), `"0.1, 0.2, 0.3"`
(vector3), `"0.1, 0.2, 0.3, 0.4"` (vector4/quat), `"#url"` (url), or a plain string or resource path (hash/text).
Types: `PROPERTY_TYPE_NUMBER|HASH|URL|VECTOR3|VECTOR4|QUAT|BOOLEAN|TEXT`.
Overrides inside a nested collection use `instance_properties { id: "<instance>" properties { id: "<component>" properties { … } } }`.

### `.go` (game object prototype)

```
components {                         # component stored in its own file
  id: "enemy"
  component: "/main/enemy.script"
  properties { id: "speed" value: "120.0" type: PROPERTY_TYPE_NUMBER }
}
components {
  id: "boom"
  component: "/main/boom.particlefx"
}
embedded_components {                # component defined inline (one level of escaping)
  id: "sprite"
  type: "sprite"
  data: "default_animation: \"ufo\"\n"
  "material: \"/builtins/materials/sprite.material\"\n"
  "textures {\n"
  "  sampler: \"texture_sampler\"\n"
  "  texture: \"/main/sprites.atlas\"\n"
  "}\n"
  ""
  scale { x: 0.5 y: 0.5 }
}
embedded_components {
  id: "factory"
  type: "factory"
  data: "prototype: \"/main/bullet.go\"\n"
  ""
}
```

An empty `.go` file is a valid game object with no components. Embedded component `type` values are the
component file extensions: `sprite`, `label`, `collisionobject`, `factory`, `collectionfactory`,
`collectionproxy`, `sound`, `particlefx`, `tilemap`, `model`, `mesh`, `camera`. Scripts and GUI are always
referenced files (`components { component: "/x.script" }` and `component: "/x.gui"`).

## Components

### `.sprite`
```
default_animation: "idle"            # atlas animation or image name (file name without extension)
material: "/builtins/materials/sprite.material"
blend_mode: BLEND_MODE_ALPHA
textures {
  sampler: "texture_sampler"
  texture: "/main/main.atlas"        # .atlas or .tilesource
}
size_mode: SIZE_MODE_AUTO            # or SIZE_MODE_MANUAL with size { x: 64.0 y: 64.0 }
```
Old files may use `tile_set: "/main/main.atlas"` instead of `textures`. Both load.

### `.label`
```
size { x: 128.0 y: 32.0 }
color { x: 1.0 y: 1.0 z: 1.0 w: 1.0 }
outline { w: 1.0 }
shadow { w: 1.0 }
leading: 1.0
pivot: PIVOT_CENTER
blend_mode: BLEND_MODE_ALPHA
text: "Label"
font: "/builtins/fonts/default.font"
material: "/builtins/fonts/label-df.material"
```

### `.collisionobject`
```
type: COLLISION_OBJECT_TYPE_DYNAMIC  # _STATIC, _KINEMATIC, _TRIGGER
mass: 1.0                            # must be 0 for static/kinematic/trigger
friction: 0.1
restitution: 0.5
group: "player"
mask: "enemy"                        # comma-separated groups it collides with
mask: "ground"
embedded_collision_shape {
  shapes {
    shape_type: TYPE_BOX             # TYPE_SPHERE, TYPE_CAPSULE, TYPE_HULL
    position { }
    rotation { }
    index: 0
    count: 3                         # number of data values used by this shape
    id: "box"
  }
  data: 16.0                         # box: half-extents x, y, z; sphere: radius; capsule: radius, height
  data: 16.0
  data: 10.0
}
linear_damping: 0.0
angular_damping: 0.0
locked_rotation: false
event_collision: true                # set false to skip collision messages
event_contact: true
event_trigger: true
```
`mask` is repeated, one group per line. Each shape's values sit in the shared `data` list, starting at `index`.

### `.factory` / `.collectionfactory` / `.collectionproxy`
```
prototype: "/main/bullet.go"         # .factory
load_dynamically: false
```
```
prototype: "/levels/level1.collection"   # .collectionfactory
```
```
collection: "/levels/level1.collection"  # .collectionproxy
exclude: false
```

### `.sound`
```
sound: "/sounds/jump.wav"            # .wav or .ogg
looping: 0
group: "master"
gain: 1.0
```

### `.camera`
```
aspect_ratio: 1.0
fov: 0.7854
near_z: -1.0
far_z: 1.0
auto_aspect_ratio: 0
orthographic_projection: 1
orthographic_zoom: 1.0
orthographic_mode: ORTHO_MODE_FIXED  # ORTHO_MODE_AUTO_FIT / ORTHO_MODE_AUTO_COVER
```

## Assets

### `.atlas`
```
images {
  image: "/assets/player_idle.png"
}
animations {
  id: "run"
  images { image: "/assets/run1.png" }
  images { image: "/assets/run2.png" }
  playback: PLAYBACK_LOOP_FORWARD    # PLAYBACK_ONCE_FORWARD, _PINGPONG, PLAYBACK_NONE …
  fps: 12
  flip_horizontal: 0
}
margin: 0
extrude_borders: 2
inner_padding: 0
```
Every image is available as an animation named after its file (`player_idle`). Image paths must exist.

### `.tilesource` / `.tilemap`
```
image: "/assets/tiles.png"
tile_width: 32
tile_height: 32
tile_margin: 0
tile_spacing: 0
collision: "/assets/tiles.png"       # optional: generate collision hulls from alpha
collision_groups: "ground"
animations { id: "water" start_tile: 1 end_tile: 4 playback: PLAYBACK_LOOP_FORWARD fps: 8 }
extrude_borders: 2
```
```
tile_set: "/assets/tiles.tilesource"
layers {
  id: "ground"
  z: 0.0
  is_visible: 1
  cell { x: 0 y: 0 tile: 5 }         # tile index is 0-based; h_flip/v_flip/rotate90: 1
}
material: "/builtins/materials/tile_map.material"
```

### `.font`
```
font: "/builtins/fonts/vera_mo_bd.ttf"   # or a project .ttf/.otf
material: "/builtins/fonts/font-df.material"
size: 32
output_format: TYPE_DISTANCE_FIELD
outline_width: 2.0
outline_alpha: 1.0
```

### `.particlefx`, `.material`, `.render`, `.model`
These are long. Create them with `edit_resource create=true`, which starts from the editor's template, or copy an
existing file. `read_resource describe=true` lists their fields. The builtins provide ready-made materials:
`/builtins/materials/{sprite,tile_map,particlefx,gui,model}.material`, and fonts in `/builtins/fonts/`.

## GUI

### `.gui`
```
script: "/gui/hud.gui_script"
fonts {
  name: "default"
  font: "/builtins/fonts/default.font"
}
textures {
  name: "ui"                         # referenced by nodes as "ui/<animation>"
  texture: "/gui/ui.atlas"
}
nodes {
  position { x: 20.0 y: 1116.0 }
  size { x: 200.0 y: 50.0 }
  type: TYPE_TEXT
  text: "Score: 0"
  font: "default"                    # a name declared in fonts
  id: "score"
  pivot: PIVOT_NW
  xanchor: XANCHOR_LEFT
  yanchor: YANCHOR_TOP
  adjust_mode: ADJUST_MODE_FIT
  layer: "text"                      # optional; must be declared in layers
}
nodes {
  position { x: 320.0 y: 100.0 }
  size { x: 200.0 y: 80.0 }
  type: TYPE_BOX
  texture: "ui/button"
  id: "play_button"
  size_mode: SIZE_MODE_MANUAL
}
nodes {
  type: TYPE_TEXT
  text: "PLAY"
  font: "default"
  id: "play_label"
  parent: "play_button"              # child position is relative to the parent
}
layers { name: "text" }
material: "/builtins/materials/gui.material"
adjust_reference: ADJUST_REFERENCE_PARENT
```
Node types: `TYPE_BOX`, `TYPE_TEXT`, `TYPE_PIE`, `TYPE_TEMPLATE` (with `template: "/other.gui"`),
`TYPE_PARTICLEFX`. GUI positions are in screen pixels of the display size from `game.project`. Node ids must be
unique, and `parent` must name an existing node.

## Input

### `.input_binding`
```
key_trigger { input: KEY_LEFT action: "left" }
key_trigger { input: KEY_SPACE action: "jump" }
mouse_trigger { input: MOUSE_BUTTON_1 action: "touch" }
mouse_trigger { input: MOUSE_WHEEL_UP action: "zoom_in" }
touch_trigger { input: TOUCH_MULTI action: "multitouch" }
gamepad_trigger { input: GAMEPAD_LSTICK_LEFT action: "left" }
text_trigger { input: TEXT action: "text" }
```
`/builtins/input/all.input_binding` lists every trigger name.

## `game.project` (INI)

```ini
[project]
title = My Game
dependencies#0 = https://github.com/britzl/monarch/archive/refs/tags/5.1.0.zip

[bootstrap]
main_collection = /main/main.collectionc

[input]
game_binding = /input/game.input_bindingc

[display]
width = 960
height = 640
high_dpi = 1

[physics]
type = 2D
gravity_y = -1000.0
scale = 0.01

[script]
shared_state = 1
```

Bootstrap and input references point to compiled resources (`c` suffix). Image paths such as icons don't.
Indexed keys (`dependencies#0`, `dependencies#1`) form lists. `validate` checks the keys against the
installed version's settings schema.

## Lua files

`.script`, `.gui_script`, `.render_script`, `.editor_script` and `.lua` are plain Lua. Defold's own templates
indent with tabs. A new `.script` normally contains only the lifecycle functions it uses.
