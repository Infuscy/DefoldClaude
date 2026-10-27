# Project settings, libraries, extensions and platforms

## game.project essentials

INI file at the project root. Unknown keys are ignored by the engine but flagged by `validate`. The effective
values, defaults included, are written to `build/<dir>/game.projectc` after a build.

| Section | Keys you will touch |
|---|---|
| `[project]` | `title`, `version`, `dependencies#0..N` (library zip URLs), `custom_resources` (extra files to bundle, e.g. JSON levels for `sys.load_resource`) |
| `[bootstrap]` | `main_collection = /main/main.collectionc`, `render = /builtins/render/default.renderc` |
| `[display]` | `width`, `height` (design resolution), `high_dpi`, `fullscreen`, `update_frequency`, `swap_interval`, `display_profiles`, `dynamic_orientation` |
| `[input]` | `game_binding = /input/game.input_bindingc`, `use_accelerometer`, `repeat_delay`, `repeat_interval` |
| `[physics]` | `type` (2D/3D), `gravity_x/y/z`, `scale`, `debug`, `use_fixed_timestep`, `max_collision_object_count` |
| `[engine]` | `fixed_update_frequency` (fixed_update rate), `max_time_step` |
| `[script]` | `shared_state` (Defold 1.13 and older; 1 = all scripts share one Lua state). Removed in 1.14, where scripts always share one state |
| `[render]` | `clear_color_red/green/blue/alpha` |
| `[sprite]`, `[label]`, `[factory]`, `[collectionfactory]`, `[collection]`, `[gui]`, `[particle_fx]`, `[sound]` | `max_count` and similar limits; raise them if the log says a limit was reached |
| `[html5]` | `scale_mode` (`downscale_fit`, `fit`, `stretch`, `no_scale`), `heap_size`, `show_fullscreen_button` |
| `[android]` | `package`, `version_code`, `minimum_sdk_version`, icons |
| `[ios]` / `[osx]` | `bundle_identifier`, icons |
| `[library]` | `include_dirs` (only for projects that are libraries) |
| `[native_extension]` | `app_manifest` (strip engine features you don't use) |

Settings can be read at runtime with `sys.get_config_string("project.title")` and `sys.get_config_number`.

## Libraries (dependencies)

1. Find the library's release zip (usually `https://github.com/<owner>/<repo>/archive/refs/tags/<version>.zip`,
   see its README or the Asset Portal at https://defold.com/assets/). Pin a tagged version, not `master`.
2. Add it to `game.project`: `dependencies#0 = <url>` (next index for more).
3. Fetch: `build command=resolve`. Through the editor this runs "Fetch Libraries". Zips land in `.internal/lib/`.
4. Library files appear under their include dirs, e.g. `/monarch/monarch.lua` → `require "monarch.monarch"`.
   They are read-only. Read them with `read_resource` and their docs with the `api` tool (`.script_api`) or README.

Common choices (check the current versions in their READMEs): Monarch (screen/popup manager on top of
proxies), Druid (GUI components), Defold-Input (input helpers), DefOS (desktop window control).

Changing dependencies is an outward-facing change for the user's project. Ask before adding one.

## Native extensions

- A folder with `ext.manifest` plus `src/` (C/C++, Objective-C, Java, JS) and optional `api/*.script_api` adds
  native code. Building it requires Defold's cloud build server (`https://build.defold.com`). The `build` tool passes
  it automatically when the project or its libraries contain extensions. The first build takes minutes.
- `.appmanifest` files strip engine features (physics, sound, …) to shrink builds; set
  `[native_extension] app_manifest`.
- Only the public Lua API of extensions is visible to `api` (from their `.script_api`).

## Bundling

`build command=bundle platform=<platform> variant=debug|release [bundle_output=<dir>]`:

| Platform | Notes |
|---|---|
| `wasm-web` | HTML5: open the output's `index.html` through a local web server (`npx http-server <dir>`); `file://` doesn't work. Runs plain Lua 5.1. Audio starts after the first user input. |
| `x86_64-win32` | Windows exe + `game.arcd` etc. |
| `arm64-macos`, `x86_64-macos` | `.app` bundle (signing/notarization are separate steps) |
| `x86_64-linux`, `arm64-linux` | binary + archives |
| `arm64-android` | `.apk`/`.aab`. Debug builds use a debug keystore; release builds need keystore options |
| `arm64-ios` | needs macOS, a signing identity and a provisioning profile |

Release builds strip debug output (`print` goes nowhere, and there is no engine service or hot reload).

## Platform specifics

- Mobile: set `[display] width/height` to the design resolution (portrait: e.g. 720x1280), `high_dpi = 1`,
  and handle aspect ratios with a camera in `ORTHO_MODE_AUTO_FIT`/`AUTO_COVER` or GUI adjust modes. Set
  `use_accelerometer = 1` only if the game reads acceleration (default 0 since Defold 1.14, 1 before). Test touch with mouse button 1.
- Detect the platform with `sys.get_sys_info().system_name` (`"Windows"`, `"Darwin"`, `"Linux"`, `"Android"`,
  `"iPhone OS"`, `"HTML5"`) and `html5.run(js)` for browser JavaScript.
- Desktop: `[display] fullscreen`; `window.set_size`, `window.get_size`, and `window.set_listener` to react to
  focus or resize.

## Project hygiene

- `.gitignore`: `/build`, `/.internal`, `/.editor_settings`, `/bundle`, OS files.
- Keep resources in feature folders (`/player`, `/enemies`, `/levels`, `/gui`, `/assets`) and shared Lua in
  modules (`/modules/*.lua`).
- The Defold editor keeps per-user state in `.editor_settings` and caches in `.internal` and `build`. None of them
  are source.
