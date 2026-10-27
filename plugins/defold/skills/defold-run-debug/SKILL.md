---
name: defold-run-debug
description: Build, run, test and debug a Defold game - compile errors, Lua runtime errors and tracebacks, game not behaving as expected, nothing visible on screen, input or collisions not working, checking the result visually with screenshots, hot reload while iterating, playtesting a feature. Use when the user wants to run or test their Defold game or when something fails at build time or runtime.
---

# Running and debugging a Defold game

The `defold` MCP tools drive the game through the **Defold editor** when it has the project open (builds and
launches exactly like pressing Build in the editor, and the user sees the game). Otherwise they run **headless**
with bob into `build/agent` and launch `dmengine`. `status` shows which applies. Both behave the same for you.

## The loop

1. `build` → fix every error it lists (`resource`, `line`, `message`). Errors in embedded components are reported
   without a file; look at the collections and game objects that embed that component type.
2. `run action=start` builds, launches and returns the first log lines plus every Lua error with `file:line` and a
   traceback. Fix runtime errors before anything else. To test one level or screen directly, add
   `collection=/levels/level3.collection`, and `config={"display.width": 480}` for game.project overrides of this run
   (headless engine only; `restart` keeps them, a plain `start` drops them).
3. Observe. After any visual change, take a screenshot before you say it works. No errors does not mean the
   player can see the result (text the same colour as the background, objects off-screen or behind the
   background, wrong z).
   - `logs` (pass the returned `cursor` to see only new output; `level=error` for problems; `grep` for your own
     `print` markers),
   - `screenshot` (`source=game`) to see the window; `frames=6 interval_ms=200` returns a numbered contact sheet and
     how many pixels changed between frames, to check that something moves, animates or falls,
   - `inspect` for live game objects, world positions and components (did the spawn happen? where is the player?),
   - `run action=command command=toggle_physics_debug` to draw collision shapes before a screenshot.
4. Change code, then `run action=reload` for script/asset tweaks (keeps the game running; `on_reload` is called,
   `init` is not), or `run action=restart` after structural changes (new objects, collections, game.project).
5. When done, `run action=stop` unless the user wants to keep playing.

A debug build started some other way (on a phone, from a debug bundle, `dmengine` launched by hand) can be
attached with `run action=attach host=<device IP> port=8001` (the port is printed as "Engine service started on
port N" when it is not 8001). `logs`, `inspect`, `input` and `run action=command` then work on it; only lines logged
after attaching are captured, `reload` is not available, and `run action=stop` quits that game.

## Playing the game

With Defold's Automation Bridge in the project (debug builds only; `/defold:setup-bridge` adds it after the user
agrees), you can interact with the running game:
- `inspect elements=true` lists visible game objects, components and GUI nodes with screen bounds and text.
- `input action=click target="Play"` clicks an element by text or name. `input action=click x=0.5 y=0.8
  normalized=true` clicks a spot you see in a screenshot. `input action=key keys=["KEY_SPACE"] hold=0.5` presses
  keys. Add `screenshot=true` to see the result. Each call returns the log lines the action produced.
- Screenshots are then taken inside the engine (exact frame, any platform).
Without the bridge, `input` explains how to add it; screenshots fall back to window capture (Windows).
For multi-step playtests, delegate to the `defold-playtester` agent so screenshots and logs stay out of the main
conversation.

Add temporary `print("[dbg] ...", value)` lines to trace logic, read them with `logs grep=[dbg]`, then remove them.

## Reading common errors

| Message | Usual cause → fix |
|---|---|
| `attempt to index a nil value (field/local 'x')` | variable never set (check `init`), wrong table key, or an API returned nil (e.g. `gui.get_node` id typo, `physics.raycast` miss) |
| `Could not send message 'x' from 'a' to 'b'` / `instance … could not be found` | wrong URL (relative vs absolute, missing `#component`, object already deleted, different socket) |
| `function called can only access instances within the same collection` | `go.*` on an object in another world (proxy). Send it a message instead |
| `'x' is not a valid property` / `property 'x' not found` | typo or wrong component (`"#sprite"` vs `"."`); check property names with `api` |
| `go.property … top level` / property type errors | `go.property` inside a function or with a computed default |
| `the texture/animation … can't be found` (build) | atlas path wrong or animation id not in the atlas; images are named after their file |
| `Max number of instances reached` / `… buffer is full` | raise the matching `max_count` in game.project |
| `The collection … could not be created since there is already a socket with the same name` | two proxy collections share a `name` |
| Nothing on screen, no errors | object not in a loaded collection, z outside -1..1, disabled component, missing camera/projection, sprite `default_animation` wrong |
| Input ignored | no `acquire_input_focus`; comparing `action_id` with a string; binding action name typo; another script consumed input (`return true`) |
| Collisions ignored | group/mask mismatch (both directions), `mass` rules, events disabled, comparing `message_id` with a string |

Use `api` for exact semantics and `docs action=search` for the manual on the subsystem.

## Notes

- Lua errors in `init` appear in the `run` report immediately. Errors in `update` repeat every frame; the log
  shows the first occurrences.
- `print` output appears as `DEBUG:SCRIPT: …`. Release bundles strip it.
- Screenshots need a visible (not minimized) game window on Windows. With the editor open,
  `screenshot source=preview path=/main/main.collection` renders a scene without running it.
- The engine service used by these tools is debug-only and may be reachable on the local network while the game
  runs. Stop games you no longer need.
