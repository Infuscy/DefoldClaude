# Defold for Claude Code

A Claude Code plugin that makes Claude effective at building games with the [Defold](https://defold.com) engine.

> **Unofficial.** This is a community project. It is not affiliated with, endorsed by or supported by the Defold
> Foundation; "Defold" is used only to say which engine the plugin works with.
>
> **Status: experimental.** Developed and tested on Windows 11 with Defold 1.14.0. Version 0.2.7 is the Defold
> tooling used in the [game-engine benchmark](https://infuscy.github.io/claude-code-2d-engines/) of 28 October 2026.

| Without it, Claude… | With it, Claude… |
|---|---|
| guesses Lua APIs from other engines | looks up the **exact API of your installed Defold version** (`api`), plus the official manuals and examples (`docs`) |
| corrupts `.collection` / `.go` / `.gui` files (strings inside strings, enums, required fields) | reads and edits them as structured data (`read_resource`, `edit_resource`), validated against Defold's own schemas |
| can't tell whether its change works | builds, runs, reads logs and Lua tracebacks, takes screenshots, inspects the live scene graph, hot-reloads and even plays the game (`build`, `run`, `logs`, `screenshot`, `inspect`, `input`) |

Every Defold file Claude writes is checked automatically (Lua syntax and common Defold mistakes, scene-file
schema, broken references), and problems are fed straight back to Claude.

## What's inside

- **Skills**: `defold` (engine model, addressing and messages, lifecycle, Lua rules, GUI/input, physics, animation,
  factories/proxies, rendering, project settings, platforms, pitfalls, generated API cheatsheet) and
  `defold-run-debug` (build → run → observe → fix loop).
- **Slash commands**: `/defold:build`, `/defold:run`, `/defold:check`, `/defold:new-project`,
  `/defold:setup-bridge`, `/defold:playtest`.
- **Agent**: `defold-playtester` plays the game (taps, keys, screenshots, logs) and reports findings.
- **MCP server** `defold` with 14 tools:

  | Tool | What it does |
  |---|---|
  | `status` | Defold install, project, editor open?, running game |
  | `api` | Lua API of the installed version (functions, messages, properties, constants; also native-extension `.script_api`) |
  | `docs` | Search/read official manuals and examples (cached locally) |
  | `read_resource` | Any resource as JSON with embedded objects decoded; `describe` gives a type's schema |
  | `edit_resource` | `set` / `insert` / `remove` on selectors such as `/embedded_instances[id=go]/data/embedded_components[id=sprite]/data/default_animation`; validates before writing; keeps untouched bytes |
  | `validate` | Whole-project or per-file checks without building |
  | `find_references` | Every file and line that uses a resource, folder or Lua module (`require "a.b"` too), for safe renames and deletes |
  | `build` | Compile (or resolve / clean / bundle); errors listed by file and line |
  | `run` | start / stop / restart / hot-reload / engine commands, returning early logs and Lua errors; `collection`/`config` boot a chosen collection with game.project overrides; `attach` connects to a debug build on a phone or started elsewhere and streams its log |
  | `logs` | Incremental engine output with Lua error extraction |
  | `screenshot` | The game window (Windows) or an editor-rendered preview of any scene; `frames` returns a numbered contact sheet over time with how much changed between frames |
  | `inspect` | Live scene graph with world positions; `elements=true` lists GUI/game elements with screen bounds |
  | `input` | Click/tap by element text or coordinates, drag, keys, text, wheel — returns the logs the action caused |
  | `new_project` | Official templates (the empty one works offline) |

- **Hooks**: a SessionStart hook that tells Claude it is in a Defold project, and a PostToolUse hook that validates
  every edited Defold file (about 70 ms).

### Two backends

If the Defold editor has the project open, the tools use the **editor's HTTP API** (Defold 1.13.2+). Builds,
runs and hot reloads behave exactly like the editor's own buttons, and the game opens on your screen. Otherwise
they work **headless**: bob builds into `build/agent` (never the editor's `build/default`) and `dmengine` runs the
game. Projects with native extensions are built with Defold's cloud build server.

## Requirements

- Claude Code 2.1.271 or newer
- Node.js 20+ on `PATH` (the MCP server and hooks are plain bundled JavaScript; nothing to `npm install`)
- The Defold editor installed (it provides Java, bob, the engine and the API docs). It is found automatically through
  the editor's `installations.json`; otherwise set the `defold_path` option.
  - **Without the editor** (CI, cloud or Linux sessions): ask Claude to run `status` with `download="stable"` (or a
    release such as `1.13.2`). It fetches `bob.jar` (which also carries the engine and builtins) and the API reference
    from d.defold.com over HTTPS, about 250 MB, cached per version. Builds then need a Java the plugin does not install:
    JDK 25 for Defold 1.13+ (for example [Eclipse Temurin](https://adoptium.net)), via `JAVA_HOME` or `PATH`. Editor-only
    features (`new_project` templates, scene previews, editor builds) are not available in this mode.
- Screenshots of the running game: Windows window capture, or in-engine capture on any platform when the project
  includes Defold's [Automation Bridge](https://github.com/defold/extension-automation-bridge) extension, which also
  enables the `input` tool. `/defold:setup-bridge` adds it (debug builds only; built on Defold's cloud build server).

## Install

From GitHub:

```bash
claude plugin marketplace add Infuscy/DefoldClaude
```

```bash
claude plugin install defold@defold-tools
```

From a local clone (use the folder you cloned into):

```bash
claude plugin marketplace add ./DefoldClaude
```

```bash
claude plugin install defold@defold-tools
```

Inside Claude Code the same works with `/plugin marketplace add …` and `/plugin install defold@defold-tools`.
Run `/mcp` to confirm the `plugin:defold:defold` server is connected. To share it with a team, commit the
marketplace to the game repository's `.claude/settings.json` (`claude plugin marketplace add … --scope project`).

### Options

| Option | Default | Meaning |
|---|---|---|
| `defold_path` | auto | Folder with the Defold editor (`Defold.exe` + `config`) |
| `hook_mode` | `strict` | `strict`: errors in edited Defold files are reported as blocking feedback; `warn`: as notes; `off`: no automatic checks |

Set them when installing, or later with `/plugin configure defold@defold-tools`.

## Using it

Open Claude Code in a Defold project (or a folder containing one) and ask for game changes in plain language:

- "Add an enemy that walks toward the player and dies when it touches a coin."
- "The player falls through the floor. Find out why."
- "Add a pause menu with Resume and Quit buttons."
- "Make an HTML5 build."

Claude reads the project, checks APIs for your Defold version, edits files, validates, builds, runs the game and
looks at the result. If the Defold editor is open, save your work there before asking Claude to change files on
disk; the editor reloads changed files automatically.

## Security notes

- The tools only talk to the local editor (`127.0.0.1`, port and token from `.internal/`) and to the debug engine
  service of games they start or find. Debug engine services may be reachable from your local network while a game
  runs, so stop games you no longer need.
- The editor's `/eval` endpoint (arbitrary editor Lua) is deliberately not exposed.
- Downloads: API docs come from your local install; manuals/examples from `defold.com`; templates from the GitHub
  URLs pinned by your Defold editor; native extensions build on `build.defold.com` (only for projects that use them).

## Troubleshooting

- **`status` says Defold not found**: set `defold_path` to the folder containing `Defold.exe`/`config`
  (macOS: `Defold.app/Contents/Resources`).
- **Editor backend not used**: the editor must have this exact project open and be Defold 1.13.2 or newer. Pass
  `backend=bob` to force headless builds.
- **Black or blank screenshot**: the game window must not be minimized. Try again after a second, or use
  `screenshot source=preview path=/main/main.collection` with the editor open.
- **Hook too strict for a legacy project**: set `hook_mode` to `warn`.

## Development

See [CLAUDE.md](CLAUDE.md) for the code layout, build/test commands and generators. In short, in `mcp/`:
`npm install`, `npm run check` (typecheck + unit tests + bundles), `npm run fetch:corpus && npm run test:corpus`
(byte-exact round-trip and zero-false-positive gates over Defold's own corpus), and the `scripts/e2e-*.ts`
end-to-end scripts.

Evals (`plugins/defold/evals`) run real Claude sessions with and without the plugin (they use your Claude usage):

```bash
EVAL_DEFOLD_HOME=<your Defold editor folder> claude plugin eval plugins/defold --runs 1 --scaffold --allow-real-servers --allow-tools Edit Write "mcp__plugin_defold_defold__*"
```

`--tag hard` selects the four harder project cases (version-specific physics API, runtime-only bugs, a nested GUI,
precise edits across escaped scene data). Eval graders cannot run a build, and only the plugin arm has build
tools, so add `--keep-temp --json result.json` and then build and run what both arms produced the same way:

```bash
cd mcp && npx tsx scripts/eval-verify.ts result.json --cleanup
```

It copies each project out of the eval temp folders, builds it, runs it, and checks the case's `verify.json`
(expected log lines, a colour that must be on screen, no Lua errors).

## License and notices

The plugin's own code and text are under the [MIT License](LICENSE). Defold-derived data (schemas generated from
Defold's `.proto` files, the builtins list, the `game.project` settings schema) is used under the Defold License;
see [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md).
