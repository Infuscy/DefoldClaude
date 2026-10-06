---
name: defold
description: Defold game engine knowledge and workflow. Use whenever the user works on a Defold project (game.project, .script, .gui_script, .render_script, .lua, .collection, .go, .gui, .atlas, .sprite, .particlefx, .tilemap, .input_binding files) or asks how to make or change something in Defold - game objects, components, collections, message passing, scripts, GUI, physics, animation, input, factories, collection proxies, cameras, rendering, sound, building, running or bundling a Defold game.
---

# Defold

Defold is a Lua-scripted 2D/3D engine. Projects are plain text files: `game.project` (INI) plus resources
in protobuf text format (`.collection`, `.go`, `.gui`, …) and Lua scripts. Everything is addressed by
project-absolute paths such as `/main/player.script`.

**Never rely on memory for API details.** Defold's API differs from Unity, Godot and LÖVE, and it changes
between versions. Check every function you are not certain about with the `api` tool, which reads the
docs of the Defold version actually installed, and use `docs` for concepts.

## Tools (MCP server `defold`)

| Need | Tool |
|---|---|
| Setup, Defold version, is the editor open, is a game running | `status` |
| Exact Lua signature, message fields, constants | `api` (`name=go.animate`, or `query=play animation`) |
| Concepts, how-tos, official examples | `docs` (`action=search`, then `read`) |
| Read a scene/resource as JSON (embedded data decoded) | `read_resource` (`describe=true` gives the schema of a type) |
| Change `.collection/.go/.gui/.atlas/...` safely | `edit_resource` (set/insert/remove, `create=true` for new files) |
| Check files without building | `validate` |
| Compile and get errors with file:line | `build` |
| Run, stop, hot-reload, physics debug | `run` |
| Engine output, prints, Lua errors | `logs` |
| See the game / a scene | `screenshot` (`source=game` or `source=preview` with `path`) |
| Live object positions and components | `inspect` (`elements=true` lists GUI/game elements with screen bounds) |
| Click, drag, press keys in the running game | `input` (needs the Automation Bridge: `/defold:setup-bridge`) |
| New project from a template | `new_project` |

The plugin also validates Defold files automatically after every Write/Edit and reports problems.

## Workflow

1. `status` → note the Defold version, the project root, and whether the editor has the project open.
   If the editor is open, ask the user to save their unsaved changes before you edit files on disk.
   The editor reloads the files you change.
2. Read before writing. Look at `game.project`, the main collection (`read_resource`) and the relevant
   scripts. Follow the project's existing structure and naming.
3. Look up APIs (`api`) and patterns (`docs`, and [references/](references/)) before coding.
4. Make the change. Lua is edited as normal text. For scene files, use `edit_resource`, or follow
   [references/file-formats.md](references/file-formats.md) exactly when writing by hand.
5. `build`. It is fast through the editor and takes a few seconds headless. Fix every error, then
   `run action=start` and read the reported Lua errors and logs.
6. Verify the behaviour with `screenshot`, `inspect` and `logs`, and with `input` to actually play it when the
   project has the Automation Bridge. After small script changes, use `run action=reload` (hot reload) instead of
   restarting. Stop the game when done (`run action=stop`). For longer playtests, delegate to the
   `defold-playtester` agent (`/defold:playtest`).

## Core model

- **Collection** (`.collection`): a tree of game objects and nested collections. The bootstrap collection
  (`game.project` → `[bootstrap] main_collection`) is loaded at start. Its `name` is the *socket* of the game
  world.
- **Game object**: has a transform and an id (a hash), and holds components. It is either a `.go` file
  instanced from a collection (`instances { prototype: "/x.go" }`) or embedded in the collection
  (`embedded_instances`). Parent/child links between instances go in `children`.
- **Components**: `script`, `sprite`, `label`, `collisionobject`, `factory`, `collectionfactory`,
  `collectionproxy`, `gui` (always a `.gui` file), `sound`, `particlefx`, `tilemap`, `model`, `mesh`,
  `camera`. A component is either a file referenced by path (`components { component: "/x.script" }`)
  or embedded (`embedded_components { type: "sprite" data: "..." }`). Scripts are always files.
- **Resources** referenced by components: `.atlas` (images + flipbook animations), `.tilesource`,
  `.font`, `.material`, `.particlefx`, `.sound`, and so on. A sprite plays an atlas animation; a single
  image is also an animation, named after the image file without its extension.

## Addressing and messages

- URL form: `[socket:][path][#fragment]`. `"."` = this game object, `"#"` = this component,
  `"#sprite"` = component `sprite` on this object, `"enemy"` = object `enemy` relative to the sender's
  collection, `"/enemy#script"` = absolute path from the world root, `"main:/enemy#script"` = with socket.
- Objects spawned in collection instances get prefixed ids (`/level1/enemy`). `go.get_id()` returns the
  hashed absolute id. Pass relative ids as strings; `hash("rel")` is never resolved relative to anything.
- `msg.post(receiver, "message_name", { field = value })`. The table must be small (≤ 2 KB, no functions).
- Receive with `function on_message(self, message_id, message, sender)`. **`message_id` is a hash.**
  Compare with `hash("name")`; precompute `local MSG_HIT = hash("hit")` at the top of the file.
  `message_id == "hit"` is always false.
- Built-in messages (`acquire_input_focus`, `enable`, `disable`, `set_parent`, physics, proxy and sound
  messages) and their fields are covered in [references/messaging-and-lifecycle.md](references/messaging-and-lifecycle.md).

## Scripts and Lua

- `.script` = game object script (go, msg, vmath, physics, factory, sprite… but not gui/render).
  `.gui_script` = GUI scene script (gui API, no go functions). `.render_script` = render pipeline.
  `.lua` = module loaded with `require("folder.module")` (dots, path from the project root, no extension).
  `.editor_script` = editor extensions (editor API, Lua 5.2).
- Lifecycle functions: `init(self)`, `final(self)`, `update(self, dt)`, `fixed_update(self, dt)` (only
  runs when physics uses a fixed timestep), `late_update(self, dt)`,
  `on_message(self, message_id, message, sender)`, `on_input(self, action_id, action)`, `on_reload(self)`.
  Spell them exactly. Remove the ones you do not use.
- Keep per-instance state in `self` (`self.speed = 100`). A top-level `local` in a script file is shared by
  every instance of that script. Declare everything `local`; globals leak across scripts (usually one
  shared Lua state).
- Language: Lua 5.1 with LuaJIT extensions. HTML5 builds run plain Lua 5.1, so avoid `goto`, integer
  division `//`, bitwise operators `& | ~ << >>` (use the `bit` module) and `table.unpack`. Use `unpack`.
- Script properties: `go.property("speed", 200)` at the top level of the file only, with a literal default.
  Types are number, boolean, hash, url (`msg.url()`), `vmath.vector3/vector4/quat`,
  `resource.atlas/font/material/texture/tile_source(...)`, and text (a string literal, Defold 1.13.2+).
  Read them as `self.speed`; override them per instance in the collection or in `factory.create`.
- Math: `vmath.vector3(x, y, z)`, `vmath.vector4`, `vmath.quat_rotation_z(angle)`, `vmath.length`,
  `vmath.normalize`, `vmath.lerp`, `vmath.dot`. Vectors are mutable userdata; reuse them in hot paths
  instead of allocating every frame.
- Debug output: `print(...)` and `pprint(table)` go to the log (`logs` tool).

## Input

- `game.project` `[input] game_binding` points to an `.input_binding` that maps triggers
  (`KEY_SPACE`, `MOUSE_BUTTON_1`, `TOUCH_MULTI`, gamepad, text) to action names.
- A script receives input only after `msg.post(".", "acquire_input_focus")` (usually in `init`).
- `on_input(self, action_id, action)`: compare `action_id == hash("jump")`. The `action` table has
  `pressed`, `released`, `repeated`, `value`, `x`, `y` (game coordinates), `screen_x`, `screen_y`,
  `dx`, `dy`, and `touch` for multi-touch. Return `true` to consume the input.
- Mouse button 1 also fires for single taps on mobile when it is bound (the mobile template binds it to
  `touch`). With a camera, convert screen to world with `camera.screen_to_world` (check it with `api`).

## Common recipes

- Move smoothly: `go.animate(".", "position", go.PLAYBACK_ONCE_FORWARD, vmath.vector3(300, 200, 0), go.EASING_OUTQUAD, 2, 0, function() print("arrived") end)`.
- Spawn: add a `factory` component (`prototype: "/enemy.go"`), then
  `local id = factory.create("#enemyfactory", pos, nil, { speed = 50 })`. Delete with `go.delete(id)`.
- Delays and repeats: `timer.delay(1.5, false, function(self, handle, dt) ... end)`.
- Flipbook: `sprite.play_flipbook("#sprite", hash("run"))`. Flip with `sprite.set_hflip("#sprite", true)`.
- Text: label `label.set_text("#label", "Score: 10")`; GUI `gui.set_text(gui.get_node("score"), "10")`.
- Collisions: add a `collisionobject` with a shape plus group and mask, then handle `collision_response`,
  `contact_point_response` or `trigger_response` (has `enter`) in `on_message`.
- Levels and screens: use collection proxies (load/init/enable, unload) or collection factories. See
  [references/gameplay-systems.md](references/gameplay-systems.md).
- Save data: `local path = sys.get_save_file("mygame", "save")`, `sys.save(path, tbl)`, `sys.load(path)`.

## Editing resource files

- Prefer `edit_resource`. It decodes embedded game objects and components (strings inside strings),
  validates against Defold's schema, writes editor-identical text and returns a diff. Use
  `read_resource describe=true` on a path with the right extension to see the fields of a type.
- By hand: use `"/absolute/paths"`, keep ids unique (instances per collection, components per game
  object, nodes per GUI), and keep `children` and `parent` references valid. Embedded data must be
  escaped exactly as shown in [references/file-formats.md](references/file-formats.md). To avoid escaping
  altogether, put components in their own files (`.sprite`, `.label`, `.collisionobject`, …) and
  reference them with `components { id: "sprite" component: "/main/player.sprite" }`.
- `game.project` is INI. Bootstrap and input entries use compiled paths
  (`main_collection = /main/main.collectionc`, `game_binding = /input/game.input_bindingc`).
- Never edit `build/` or `.internal/`. Library code from dependencies is read-only (`read_resource` can
  open it).

## References

Read only what the task needs:
- [references/file-formats.md](references/file-formats.md): exact text format of every resource type,
  escaping rules, minimal templates.
- [references/messaging-and-lifecycle.md](references/messaging-and-lifecycle.md): addressing details, all
  built-in messages, frame order, properties.
- [references/gui-and-input.md](references/gui-and-input.md): GUI scenes, nodes, layout, input bindings,
  touch/mouse/keyboard/gamepad.
- [references/gameplay-systems.md](references/gameplay-systems.md): physics, animation, factories, proxies,
  camera and render basics, sound, particles, tilemaps.
- [references/project-and-platforms.md](references/project-and-platforms.md): game.project settings,
  dependencies and native extensions, bundling for HTML5/mobile/desktop.
- [references/patterns-and-pitfalls.md](references/patterns-and-pitfalls.md): idiomatic structure and the
  mistakes to avoid.
- [references/api-core.md](references/api-core.md): one-line signatures of the core API for this Defold
  version (generated).
