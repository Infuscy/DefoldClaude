# GUI and input

## GUI scenes

- A GUI is a `.gui` scene file plus a `.gui_script`. Add it to a game object in a collection as a **referenced**
  component: `components { id: "hud" component: "/gui/hud.gui" }`. GUI is drawn in screen space on top of the
  game by the default render script.
- A scene declares `fonts`, `textures` (atlases, referenced by nodes as `"<texture name>/<animation>"`), `layers`
  (draw order and batching), `materials`, and `nodes`. Node types: box (image/colour rectangle, can be 9-sliced),
  text, pie, template (instance of another `.gui`; children get ids `template_id/child_id`), particlefx.
- Coordinates are pixels in the project's display size (`[display] width/height`). How nodes follow a resized window
  is controlled by `adjust_reference`, per-node `adjust_mode` (`ADJUST_MODE_FIT`, `_ZOOM`, `_STRETCH`), anchors
  (`xanchor`/`yanchor` keep a node attached to a screen edge) and `pivot`. Children are positioned relative to their
  parent.
- `layouts` provide per-orientation/device overrides (with display profiles). The script gets `layout_changed`.
- Draw order: hierarchy order within a layer, then layers in declared order. Too many layers or textures break
  batching.

## gui_script essentials

```lua
local ACTION_TOUCH = hash("touch")

function init(self)
    msg.post(".", "acquire_input_focus")       -- GUI scripts need input focus too
    self.score_node = gui.get_node("score")    -- ids from the .gui; template children are "tmpl/child"
    self.button = gui.get_node("play_button")
    self.score = 0
end

function on_message(self, message_id, message, sender)
    if message_id == hash("add_score") then
        self.score = self.score + message.amount
        gui.set_text(self.score_node, "Score: " .. self.score)
    end
end

function on_input(self, action_id, action)
    if action_id == ACTION_TOUCH and action.pressed and gui.pick_node(self.button, action.x, action.y) then
        gui.animate(self.button, "scale", vmath.vector3(0.9, 0.9, 1), gui.EASING_OUTQUAD, 0.1, 0, nil, gui.PLAYBACK_ONCE_PINGPONG)
        msg.post("/game#controller", "start_game")
        return true                              -- consume so game objects do not also react
    end
end
```

Key functions (check details with `api`):
- Nodes: `gui.get_node(id)`, `gui.new_box_node(pos, size)`, `gui.new_text_node(pos, text)`, `gui.clone(node)`,
  `gui.clone_tree(node)`, `gui.delete_node(node)`, `gui.set_parent(node, parent, keep_scene_transform)`.
- Properties: `gui.set_position/get_position`, `gui.set_scale`, `gui.set_rotation`, `gui.set_euler`,
  `gui.set_size`, `gui.set_color` (vector4 with alpha), `gui.set_alpha`, `gui.set_enabled` / `gui.is_enabled`,
  `gui.set_text` / `gui.get_text`, `gui.set_texture(node, "ui")`, `gui.play_flipbook(node, "anim")`,
  `gui.set_layer`, `gui.set_render_order(n)` (orders whole GUI components).
- Animation: `gui.animate(node, property, to, easing, duration, [delay], [complete_function], [playback])`.
  The argument order differs from `go.animate` (no playback before `to`). Properties can be given as strings
  (`"position"`, `"position.x"`, `"color.w"`, `"scale"`, `"size"`) or constants (`gui.PROP_POSITION`).
  `gui.cancel_animations(node, property)` stops an animation.
- Hit testing: `gui.pick_node(node, x, y)` with `action.x/action.y`. It ignores whether a node is enabled, so
  check `gui.is_enabled(node)` yourself.
- Screen information: `gui.get_width()`, `gui.get_height()`, `gui.get_screen_position(node)`.
- GUI scripts cannot call `go.*`. Talk to game objects with `msg.post`. Game scripts cannot call `gui.*`, so
  send the GUI a message instead.

## Input bindings

`game.project` `[input] game_binding = /input/game.input_bindingc` points at the bindings file:

```
key_trigger { input: KEY_LEFT action: "left" }
key_trigger { input: KEY_RIGHT action: "right" }
key_trigger { input: KEY_SPACE action: "jump" }
mouse_trigger { input: MOUSE_BUTTON_1 action: "touch" }
touch_trigger { input: TOUCH_MULTI action: "multitouch" }
text_trigger { input: TEXT action: "type" }
gamepad_trigger { input: GAMEPAD_RPAD_DOWN action: "jump" }
```

Several triggers can map to the same action. Mouse button 1 also fires for the first finger on touch screens, so
one `touch` action covers desktop and mobile.

## on_input

```lua
function init(self)
    msg.post(".", "acquire_input_focus")
    self.dir = vmath.vector3()
end

function on_input(self, action_id, action)
    if action_id == hash("left") then
        self.dir.x = action.released and 0 or -1   -- held keys repeat `pressed=false`, `value=1` each frame
    elseif action_id == hash("right") then
        self.dir.x = action.released and 0 or 1
    elseif action_id == hash("touch") and action.pressed then
        local world = camera.screen_to_world(vmath.vector3(action.screen_x, action.screen_y, 0))
        go.animate(".", "position", go.PLAYBACK_ONCE_FORWARD, world, go.EASING_OUTQUAD, 0.4)
    elseif action_id == nil then
        -- mouse movement: action.x/y, action.dx/dy
    end
end

function update(self, dt)
    local p = go.get_position()
    go.set_position(p + self.dir * 200 * dt)
end
```

- `action` fields: `pressed`, `released`, `repeated` (key repeat), `value` (0..1, axes and triggers), `x`, `y`
  (game coordinates in the display size), `dx`, `dy`, `screen_x`, `screen_y`, `screen_dx`, `screen_dy`
  (window pixels), `touch` (array for `TOUCH_MULTI`: `id`, `pressed`, `released`, `x`, `y`, …), `text` (for
  `TEXT`), `gamepad` (index).
- Input is delivered while the key is held. Use `pressed` for one-shot actions and `released` to stop.
- The focus stack: the last script that acquired focus receives input first, and returning `true` consumes it.
  Proxy-loaded collections only get input if the game object holding the proxy has input focus.
- Release focus in `final` or when hiding UI: `msg.post(".", "release_input_focus")`.
- World coordinates: without a camera, `action.x/y` are in game coordinates (equal to world coordinates for the
  default stretch projection). With a camera component (orthographic zoom or scrolling), use
  `camera.screen_to_world(vmath.vector3(action.screen_x, action.screen_y, 0))`.
- Text entry: bind `text_trigger TEXT`, then read `action.text` (one character or string per event).
  `MARKED_TEXT` is for IME composition.
