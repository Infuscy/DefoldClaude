# DefoldClaude — developer guide

Claude Code plugin + marketplace for the Defold game engine. The repo is its own marketplace (`defold-tools`)
holding one plugin (`defold`) in `plugins/defold/`. Only that folder is copied to users' plugin cache.

## Layout
- `plugins/defold/` — the shipped plugin: `.claude-plugin/plugin.json`, `.mcp.json`, `hooks/`, `skills/`,
  `dist/*.mjs` (generated bundles — never edit by hand).
- `mcp/` — TypeScript sources for the MCP server (`src/server.ts`) and the hook entry (`src/hook.ts`).
  - `src/env/` install + project discovery, `src/runtime/` bob/engine/editor processes, `src/ddf/` Defold
    protobuf-text codec + validator, `src/lua/` Lua checks, `src/docs/` API index + manuals, `src/tools/` MCP tools.
  - `scripts/` generators (schema, corpus, cheatsheet) and `smoke.ts`.
  - `test/unit` (fast, no Defold needed), `test/corpus` (needs `npm run fetch:corpus`),
    `test/integration` (needs a local Defold install; uses temp copies only).

## Commands (run in `mcp/`)
- `npm run check` — typecheck + unit tests + rebuild bundles. Always run before committing; commit the
  regenerated `plugins/defold/dist/*.mjs` together with the source change (CI fails on stale bundles).
- `npx tsx scripts/smoke.ts <projectDir> <tool> '<json args>'` — call a tool through the real stdio bundle.
- `claude plugin validate --strict plugins/defold` and `claude plugin validate --strict .` (repo root).
- Local try-out: `claude --plugin-dir plugins/defold`, then `/mcp` should list `plugin:defold:defold`.

## Rules
- Never modify user Defold projects in tests; copy them to a temp dir first. The reference project is
  `C:\GIT\DefoldProjects\Mobile Game` (path with a space — keep it that way in tests).
- MCP stdio: never write to stdout from server code; log with `src/util/log.ts` (stderr).
- Tool names and input schemas live in `mcp/src/tools/schemas.ts`; skills and evals depend on them.
- Keep tool output compact (results are capped at ~24k chars); page long content.
- Headless builds go to `build/agent`, never the editor's `build/default`.
- Skill text is our own wording; do not paste Defold manuals (they are fetched at runtime by the `docs` tool).
