# Patterns and pitfalls

## Pitfalls (check these first when something "does nothing")

1. **Comparing hashes with strings.** `message_id == "hit"` and `action_id == "jump"` are always false. Use
   `hash("hit")` (pre-hashed locals). The same applies to `message.other_id`, `go.get_id()` and group names.
2. **No input focus.** `on_input` never fires without `msg.post(".", "acquire_input_focus")`, and GUI scripts
   need it too. Objects in proxy-loaded collections need their proxy's game object to have focus.
3. **Wrong script type.** `gui.*` only works in `.gui_script`, `go.*` and component APIs only in `.script`,
   `render.*` only in `.render_script`. Communicate between them with `msg.post`.
4. **Script not attached.** A `.script` or `.gui` file does nothing until a game object in a loaded collection
   references it as a component, and that game object is in the bootstrap collection (or spawned).
5. **Other engines' APIs.** There is no `GameObject.Find`, `transform.position`, `Instantiate`, `Destroy`,
   `love.graphics`, `get_node("../x")` or `scene.add`. Defold uses `go.get_position`, `factory.create`,
   `go.delete` and messages. Verify unfamiliar calls with `api`.
6. **`go.property` misuse.** It is only valid at the top level with a literal default. Properties are read through
   `self`, not globals.
7. **Moving dynamic bodies with `go.set_position`.** Physics fights you. Use velocity or forces, or make the
   object kinematic.
8. **Invisible objects.** z outside the camera's near/far (-1..1 by default), a missing atlas animation (build
   error), a disabled component, alpha 0, or the object is not in a loaded collection.
9. **No collisions.** Groups and masks don't match in both directions, a static object has mass > 0, a
   kinematic object is expected to stop by itself, or events are disabled on the collision object.
10. **Relative ids after restructuring.** When objects move into a sub-collection their ids get a prefix
    (`/level/player`). Relative addresses like `"player"` only resolve within the same collection.
11. **Messages to deleted objects** log an error. Track ids and clear them in `final` or on deletion messages.
12. **Garbage every frame.** `vmath.vector3()` allocates. Reuse vectors stored in `self`, and avoid creating
    tables and closures in `update`.
13. **Globals.** A missing `local` leaks into every script when `shared_state` is on. Module tables
    (`require`) are shared by all scripts too, so keep per-instance state in `self`.
14. **Lua version.** Code must run on plain Lua 5.1 for HTML5: no `goto`, `//`, bitwise operators,
    `table.unpack` or integer formatting assumptions. Use `bit.band`, `math.floor` and `unpack`.
15. **Hot reload doesn't re-run `init`.** Put re-initialisation in `on_reload`, or restart with
    `run action=restart`.
16. **`require "folder/module.lua"`.** Write `require "folder.module"`: dots, no extension, path from the
    project root.
17. **Editing generated or cache files.** Never touch `build/` or `.internal/`. Library code is read-only.
18. **Embedded data escaping.** Broken quotes inside `data:` strings corrupt the whole collection. Use
    `edit_resource`, or reference separate component files instead of embedding.
19. **Socket clashes.** Two loaded proxy collections with the same `name` fail to load.
20. **Limits.** "Max number of instances reached", "sprite buffer is full" and similar messages mean a
    `game.project` `max_count` is too low.

## Architecture patterns

- **Bootstrap + controller:** the main collection holds a `controller` game object (game state, proxies, score)
  and the camera. Gameplay objects live in level collections or are spawned by factories.
- **Message-driven components:** each script owns one responsibility (movement, health, weapon) and talks
  through messages. Name messages as verbs (`take_damage`, `start_level`), pre-hash them in the file that
  receives them, and keep payloads small.
- **Shared Lua modules:** put constants, configuration, utilities and pure logic in `.lua` modules. Keep
  instance state in `self`, and pass `self` into module functions that need it.
- **Tuning through properties:** expose speeds, damage and timings as `go.property` so levels can override them
  per instance.
- **State machines:** a table of state handlers (`self.state = "idle"`, `states[self.state].update(self, dt)`)
  keeps `update` and `on_input` readable.
- **Frame independence:** multiply movement by `dt`. Use `fixed_update` (with fixed timestep enabled) for physics
  driven logic.
- **UI:** one `.gui` per screen (HUD, menus) on its own game object. Show and hide with `enable`/`disable` or
  load screens through proxies (Monarch). Return `true` from GUI `on_input` when a button handled the input.
- **Spawning:** factories for single objects, collection factories for prefabs. Pool frequently spawned objects.
- **Persistence:** `sys.save(sys.get_save_file("mygame", "progress"), tbl)` and `sys.load(...)`. Plain Lua
  tables only.
- **Timing:** `timer.delay` instead of counting `dt` by hand. Cancel timers in `final`.
- **Debugging:** `print`/`pprint`, `logs level=error`, `run action=command command=toggle_physics_debug`,
  `inspect` for live positions, `screenshot` to see the result.
