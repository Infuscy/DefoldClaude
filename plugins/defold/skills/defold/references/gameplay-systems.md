# Gameplay systems

## Physics

**Collision object types:** `DYNAMIC` (simulated, moved by forces/velocity), `KINEMATIC` (moved by your script;
pushes dynamic bodies but you resolve its own penetration), `STATIC` (never moves), `TRIGGER` (no collision
response, only `trigger_response` enter/exit). Static, kinematic and trigger objects need `mass: 0`.

**Groups and masks:** two objects interact only if each one's mask contains the other's group. Groups are free
strings (`player`, `enemy`, `ground`); a project can have at most 16.

**Scale:** `[physics] scale` converts pixels to meters (templates use `0.01`, i.e. 100 px = 1 m) with
`gravity_y = -1000` (pixels/s²). Set `type = 3D` for 3D physics.

**Messages** (handle in `on_message`): `collision_response` (once per pair per frame), `contact_point_response`
(per contact point, with `normal`, `distance`, `applied_impulse` — use it to separate kinematic bodies),
`trigger_response` (`enter` true/false). Set `event_collision/event_contact/event_trigger: false` on the
collision object to skip messages you don't need, or route everything to one callback with
`physics.set_event_listener`.

**Kinematic separation:** the standard platformer pattern, which keeps a character out of walls.

```lua
local CONTACT = hash("contact_point_response")
local GROUND = hash("ground")

function update(self, dt)
    -- move (self.velocity is a vector3) ...
    go.set_position(go.get_position() + self.velocity * dt)
    self.correction = vmath.vector3()        -- reset every frame
end

function on_message(self, message_id, message, sender)
    if message_id == CONTACT and message.other_group == GROUND then
        if message.distance > 0 then
            local proj = vmath.dot(self.correction, message.normal)
            local comp = (message.distance - proj) * message.normal
            self.correction = self.correction + comp
            go.set_position(go.get_position() + comp)
        end
        if message.normal.y > 0.7 then self.ground_contact = true end
    end
end
```

Use `message.other_group` / `message.own_group` to tell what was hit.

**Velocity and forces (dynamic bodies):**
`go.set("#collisionobject", "linear_velocity", vmath.vector3(0, 500, 0))`,
`msg.post("#collisionobject", "apply_force", { force = vmath.vector3(0, 9000, 0), position = go.get_world_position() })`.
Never set the position of a dynamic body every frame; drive it with velocity or forces.

**Ray casts:** `local hit = physics.raycast(from, to, { hash("ground") })` returns a table
(`position`, `normal`, `id`, `fraction`, `group`) or `nil`, synchronously. `physics.raycast_async` answers with
`ray_cast_response` / `ray_cast_missed` messages. Other tools: `physics.set_group`, `physics.set_maskbit`,
`physics.set_hflip` (flip shapes with the sprite), joints (`physics.create_joint`), `physics.set_gravity`.
`run action=command command=toggle_physics_debug` draws the shapes while the game runs.

## Animation

- **Properties:** `go.animate(url, property, playback, to, easing, duration, [delay], [complete_function])`.
  Properties include `"position"`, `"position.x"`, `"euler.z"`, `"scale"`, sprite `"tint.w"` (fade) and script
  properties. Playback: `go.PLAYBACK_ONCE_FORWARD`, `_ONCE_BACKWARD`, `_ONCE_PINGPONG`, `_LOOP_FORWARD`,
  `_LOOP_BACKWARD`, `_LOOP_PINGPONG`. Easing: `go.EASING_LINEAR`, `go.EASING_OUTQUAD`, `go.EASING_INOUTSINE`,
  `go.EASING_OUTBOUNCE`, … (or a `vmath.vector` curve). Stop with `go.cancel_animations(url, property)`.
  The callback receives `(self, url, property)`.
- **Flipbooks:** define animations in an `.atlas` (or tile source) with fps and playback, then
  `sprite.play_flipbook("#sprite", "run", function(self, message_id, message, sender) ... end, { offset = 0, playback_rate = 1 })`.
  The callback fires for one-shot animations. Read the current animation with
  `go.get("#sprite", "animation")`.
- **GUI:** `gui.animate` (see gui-and-input). **Models:** `model.play_anim("#model", "walk", go.PLAYBACK_LOOP_FORWARD)`.
- **Sequencing:** chain callbacks or use `timer.delay(seconds, repeating, function(self, handle, elapsed) end)`
  and `timer.cancel(handle)`. Per-frame custom motion goes in `update(self, dt)`.

## Spawning: factories and collection factories

```lua
-- game object with a factory component "enemyfactory" whose prototype is /enemy/enemy.go
local id = factory.create("#enemyfactory", vmath.vector3(100, 200, 0), nil, { speed = 80 }, 1.0)
msg.post(id, "set_target", { target = go.get_id() })   -- the new object can receive messages right away
go.delete(id)                                           -- remove it (end of frame); go.delete() deletes self
```

- `factory.create(url, [position], [rotation], [properties], [scale])` returns the new absolute id. Properties
  override the prototype's `go.property` values.
- `collectionfactory.create(url, [position], [rotation], [properties], [scale])` spawns a whole collection and
  returns `{ [hash("/root")] = id, … }`. Properties are keyed by the instance id inside the collection.
- Dynamic loading: `load_dynamically: true` plus `factory.load(url, callback)` / `factory.unload(url)`.
  `dynamic_prototype` with `factory.set_prototype` swaps the prototype at runtime.
- Limits: `[factory] max_count`, `[collectionfactory] max_count` and `[collection] max_instances` (1024
  objects per collection) in `game.project`. Raise them for bullet-hell style games.
- Pooling: instead of creating and deleting hundreds of objects per second, hide and reuse them
  (`msg.post(id, "disable")` / `"enable"`).

## Levels and screens: collection proxies

```lua
local PROXY_LOADED = hash("proxy_loaded")
local PROXY_UNLOADED = hash("proxy_unloaded")

function init(self)
    msg.post(".", "acquire_input_focus")           -- needed for input to reach the loaded world
    msg.post("#level1_proxy", "async_load")
end

function on_message(self, message_id, message, sender)
    if message_id == PROXY_LOADED then
        msg.post(sender, "init")
        msg.post(sender, "enable")
    elseif message_id == hash("next_level") then
        msg.post("#level1_proxy", "unload")         -- disables and finalizes automatically
    elseif message_id == PROXY_UNLOADED then
        msg.post("#level2_proxy", "async_load")
    end
end
```

- Each proxied collection is a separate world with its own physics. Its socket is the collection `name`, which
  must be unique among loaded worlds. Address it as `"level1:/player#script"`.
- `set_time_step` (`factor`, `mode`) on the proxy slows down or pauses that world (factor 0).
- Libraries such as Monarch wrap screen management on top of proxies.
- Use a **collection factory** instead when the objects should live in the current world (e.g. spawning a
  prefab group or a level chunk).

## Camera and rendering

- The default render script (`/builtins/render/default.render_script`) renders through the active camera
  component if one exists. Otherwise it uses a stretch projection over the `game.project` display size.
- Camera component: `orthographic_projection: 1` for 2D. `orthographic_mode`: `ORTHO_MODE_FIXED` (uses
  `orthographic_zoom`), `ORTHO_MODE_AUTO_FIT` (show the whole design area) or `ORTHO_MODE_AUTO_COVER` (fill the
  window). Follow a target by parenting the camera game object to it or by moving it in `update`. The camera looks
  at its game object's position.
- Conversions: `camera.screen_to_world(vmath.vector3(screen_x, screen_y, 0))`,
  `camera.world_to_screen(world_pos)`; `camera.get_cameras()` lists cameras.
- Without a camera, send projection messages to the render script:
  `msg.post("@render:", "use_fixed_fit_projection", { near = -1, far = 1 })`.
  Set the background colour with `msg.post("@render:", "clear_color", { color = vmath.vector4(0.1, 0.1, 0.2, 1) })`.
- Draw order in 2D follows z position (-1 to 1 with the default projection; higher z is in front). Keep z within the
  camera's near/far range, or objects disappear.
- Custom pipeline: copy `/builtins/render/default.render` and `.render_script` into the project, edit them, and
  point `[bootstrap] render` at your `.renderc`. Materials pick a pipeline pass through their `tags`
  (`tile`, `gui`, `particle`, `model`, `debug_text`).

## Sound

- Sound component (`.sound` file or embedded) referencing a `.wav` or `.ogg`.
  `sound.play("#music", { gain = 0.6, speed = 1.0 }, function(self, message_id, message, sender) end)` returns a
  play id. Stop with `sound.stop("#music")`, set group volume with `sound.set_group_gain("master", 0.5)`.
- `looping: 1` for music. Each component can play several instances (`[sound] max_sound_instances`).
- Browsers (HTML5) only start audio after a user interaction (first click or tap).

## Particles

- `.particlefx` (emitters and modifiers) as a component: `particlefx.play("#explosion")`,
  `particlefx.stop("#explosion")`. Set `max_particle_count` per emitter and keep project limits
  (`[particle_fx]`) in mind. Particles in GUI use particlefx nodes.

## Tile maps

- `.tilesource` (tile grid image, optional collision) and `.tilemap` (layers of cells) as a `tilemap` component.
- `tilemap.set_tile(url, layer, x, y, tile)` / `tilemap.get_tile(url, layer, x, y)` use **1-based** tile indices,
  and 0 means empty. The file format stores 0-based indices. `tilemap.get_bounds(url)` returns
  `x, y, w, h`.
- Collision shapes come from the tile source's `collision` image and its group. Add a collision object with
  `collision_shape` pointing at the `.tilemap` file.
