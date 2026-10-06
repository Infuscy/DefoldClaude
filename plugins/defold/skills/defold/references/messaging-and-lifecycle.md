# Addressing, messages, lifecycle and properties

## Addressing

A URL is `[socket:][path][#fragment]`:
- **socket**: the game world. The bootstrap collection's `name` is the main socket. Each collection loaded through
  a collection proxy is its own world named after that collection's `name`, so every proxied collection needs a
  unique `name`.
- **path**: the game object id, e.g. `/player` or `/level/enemy_1` (collection instances prefix their ids).
- **fragment**: a component id on that game object, e.g. `#sprite`.

| Written | Means |
|---|---|
| `"."` | this game object |
| `"#"` | this component (the running script) |
| `"#sprite"` | component `sprite` on this game object |
| `"enemy"` | game object `enemy` in the sender's collection (relative) |
| `"enemy#script"` | component on that relative object |
| `"/enemy#script"` | absolute path from the root of this world |
| `"level:/enemy#script"` | object in another world (a proxied collection named `level`) |
| `msg.url()` | URL of the current script; `msg.url("socket", "/path", "fragment")` builds one |

- Runtime ids are hashes. `go.get_id()` returns the hashed absolute path of this object, and
  `go.get_id("enemy")` resolves a relative id.
- Relative ids must be passed as strings. A hash cannot be resolved relative to the sender.
- `factory.create` returns the new object's absolute id (a hash). `collectionfactory.create` returns a table that
  maps `hash("/id_in_collection")` to spawned ids.
- Avoid `:` and `#` in ids.

## Message passing

```lua
local MSG_DAMAGE = hash("damage")             -- pre-hash message ids once per file

-- sender
msg.post("/player#health", "damage", { amount = 10 })

-- receiver (/player#health)
function on_message(self, message_id, message, sender)
    if message_id == MSG_DAMAGE then
        self.hp = self.hp - message.amount
        msg.post(sender, "damage_ok")         -- reply to whoever sent it
    end
end
```

- Messages are queued and delivered later in the same frame. Do not expect a reply before `msg.post` returns.
- The payload is a Lua table up to ~2 KB containing numbers, strings, booleans, hashes, urls, vmath values and
  nested tables. It cannot contain functions, userdata handles or game object references other than ids.
- `message_id` arrives as a hash. Fields keep their Lua types.
- Sending to a missing receiver logs `Could not send message … because the instance … does not exist`.
- To broadcast, send to each receiver. A common pattern is a manager script that keeps a list of URLs.

## Built-in messages (Defold 1.13)

Use `api name=<message>` for exact fields and examples.

| Receiver | Message | Fields / notes |
|---|---|---|
| any game object | `acquire_input_focus`, `release_input_focus` | send to `"."` from a script |
| any game object | `set_parent` | `parent_id`, `keep_world_transform` (prefer `go.set_parent`) |
| component | `enable`, `disable` | sprites, labels, collision objects, gui, models, tilemaps, proxies, cameras… |
| sprite | `play_animation` (legacy; prefer `sprite.play_flipbook`) | `id`, `offset`, `playback_rate` |
| from sprite | `animation_done` | `current_tile`, `id` (only without a completion callback) |
| from model | `model_animation_done` | `animation_id`, `playback` |
| from physics | `collision_response` | `other_id`, `other_position`, `other_group`, `own_group` |
| from physics | `contact_point_response` | `position`, `normal`, `distance`, `applied_impulse`, `relative_velocity`, `mass`, `other_mass`, `other_id`, `other_position`, `other_group`, `own_group`, `life_time` |
| from physics | `trigger_response` | `other_id`, `enter` (true/false), `other_group`, `own_group` |
| from physics | `ray_cast_response` / `ray_cast_missed` | `fraction`, `position`, `normal`, `id`, `group`, `request_id` (from `physics.raycast_async`) |
| collision object | `apply_force` | `force`, `position` (world) |
| collection proxy | `load`, `async_load`, `init`, `enable`, `disable`, `final`, `unload` | send to `"#proxy"` |
| collection proxy | `set_time_step` | `factor`, `mode` (0 continuous, 1 discrete) for slow motion/pause |
| from collection proxy | `proxy_loaded`, `proxy_unloaded`, `proxy_loading` (`progress`), `proxy_ready`, `proxy_error` (`code`) | sent back to the script that asked |
| sound component | `play_sound`, `stop_sound`, `set_gain` | prefer `sound.play`/`sound.stop` |
| from sound | `sound_done`, `sound_stopped` | `play_id` |
| camera | `set_camera` | `aspect_ratio`, `fov`, `near_z`, `far_z`, `orthographic_projection`, `orthographic_zoom`, `orthographic_mode` |
| `"@render:"` | `clear_color` `{color}`, `draw_line` `{start_point, end_point, color}`, `draw_debug_text` `{position, text, color}`, `resize` `{width, height}`; the default render script also understands `use_fixed_fit_projection`, `use_fixed_projection`, `use_stretch_projection`, `use_camera_projection` | |
| from `@render` | `window_resized` | `width`, `height` (received by the render script) |
| `"@system:"` | `exit` `{code}`, `reboot`, `toggle_profile`, `toggle_physics_debug`, `set_update_frequency` `{frequency}`, `set_vsync` `{swap_interval}`, `start_record`, `stop_record`, `resume_rendering` | |
| GUI script | `layout_changed` | `id`, `previous_id` |

Physics events can also be received centrally with `physics.set_event_listener` (events `collision_event`,
`contact_point_event`, `trigger_event`). Check the current API with `api name=physics.set_event_listener`.

## Lifecycle

| Function | When |
|---|---|
| `init(self)` | once, after the object is created (initialization order between components is not specified) |
| `fixed_update(self, dt)` | 0..N times per frame at the fixed rate; only if `[physics] use_fixed_timestep = 1` and `[engine] fixed_update_frequency > 0` |
| `update(self, dt)` | once per frame |
| `late_update(self, dt)` | once per frame after all `update` calls |
| `on_message(self, message_id, message, sender)` | for each message delivered to this component |
| `on_input(self, action_id, action)` | for input when the object holds input focus; return `true` to consume |
| `on_reload(self)` | after hot reload of this script |
| `final(self)` | when the object or collection is deleted; clean up timers, listeners and references here |

Frame order: input dispatch → per collection and component type: `fixed_update`, `update`, `late_update`
(messages are dispatched after each component type, so a message often arrives in the same frame) → render
script → post-update (`final` of deleted objects, factory spawns, deletions, proxy unloads) → frame drawn.
Objects created with `factory.create` appear after the current update phase. `go.delete` takes effect at the
end of the frame.

## Script properties

```lua
go.property("speed", 200)                    -- number
go.property("alive", true)                   -- boolean
go.property("target", msg.url())             -- url
go.property("kind", hash("goblin"))          -- hash
go.property("velocity", vmath.vector3())     -- vector3 (also vector4, quat)
go.property("skin", resource.atlas("/main/goblin.atlas"))  -- resource (atlas/font/material/texture/tile_source)
go.property("title", "Goblin")               -- text (Defold 1.13.2+)

function init(self)
    print(self.speed, self.title)
end
```

- `go.property` must be called at the top level of the script with a literal default (no expressions or
  variables).
- Read and write as `self.name`. From other scripts use `go.get("/goblin#script", "speed")` and
  `go.set(url, "speed", 300)`. Numeric and vector properties can be animated with `go.animate`.
- Override per instance in a collection (`component_properties`, see file-formats), per spawn with
  `factory.create(url, pos, rot, { speed = 50 })`, or per collection spawn with
  `collectionfactory.create(url, pos, rot, { [hash("/goblin")] = { speed = 50 } })`.

## Game object and component properties

- Game object: `position`, `rotation`, `euler`, `scale`, and sub-fields (`"position.x"`, `"euler.z"`), all usable
  with `go.get`/`go.set`/`go.animate(".", "position.y", …)`.
- Sprite: `size`, `scale`, `slice`, `image`, `material`, `cursor`, `playback_rate`, `animation`, `frame_count`.
  Tint and other material constants go through `go.set("#sprite", "tint", vmath.vector4(1, 0, 0, 1))`.
- Label: `text`, `color`, `outline`, `shadow`, `scale`, `size`, `font`, `material`, `leading`, `tracking`,
  `line_break`.
- Collision object: `mass` (read only), `linear_velocity`, `angular_velocity`, `linear_damping`,
  `angular_damping`.
- Sound: `gain`, `pan`, `speed`, `sound`. Camera: `fov`, `near_z`, `far_z`, `orthographic_zoom`, `aspect_ratio`,
  `projection`, `view`. Model: `cursor`, `playback_rate`, `animation`, `texture0`…`texture7`.
