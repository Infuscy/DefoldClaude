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
- `npx tsx scripts/e2e-run.ts "<project>" bob|editor [--in-place]` — build/run/logs/screenshot/reload loop;
  `scripts/e2e-edit.ts "<project>"` — edit_resource → validate → bob build; `scripts/e2e-orphan.ts`;
  `scripts/e2e-attach.ts "<project>"` — run action=attach on a dmengine started outside the server;
  `scripts/e2e-launch.ts "<project>"` — start in another collection with config overrides, screenshot bursts.
- `npm run fetch:corpus` then `npm run test:corpus` — byte-identical round-trip and zero-false-positive gates
  on Defold's save_data_project, defold/examples, builtins and the local example project.
- `npx tsx scripts/check-skills.ts` — every API/tool named in skills must exist (needs local Defold).
- `npx tsx scripts/eval-verify.ts <eval-result.json> [--cleanup]` — build and run every arm's project from a
  `claude plugin eval … --keep-temp --json` run against `evals/<case>/verify.json`; `--project <dir> --case <name>`
  checks one project (use it on a reference solution after changing a case).
- `claude plugin validate --strict plugins/defold` and `claude plugin validate --strict .` (repo root).
- Local try-out: `claude --plugin-dir plugins/defold`, then `/mcp` should list `plugin:defold:defold`.

## Generated data (commit the outputs)
- `scripts/gen-schema.ts [tag]` → `src/ddf/schema.generated.json` (messages/enums from Defold's .proto files;
  extension→message map lives in the script).
- `scripts/gen-gameproject.ts` → `src/ddf/gameproject.generated.json` (bob meta.properties) and
  `src/ddf/builtins.generated.json` (from the local editor jar).
- `scripts/gen-fieldorder.ts` → `src/ddf/fieldorder.generated.json` (editor field order learned from corpus).
- `scripts/gen-api-core.ts` → `plugins/defold/skills/defold/references/api-core.md`.
- `scripts/gen-eval-fixture.ts` → `plugins/defold/evals/_fixtures/*` (start projects for project eval cases) and
  `test/fixtures/eval-reference/<case>` (correct solutions, kept outside the plugin so evaluated agents can't
  read them; `test/unit/eval-graders.test.ts` checks the file graders accept them and reject the start state).
  Regenerate all of them when targeting a new Defold version.

## Rules
- Never modify user Defold projects in tests; copy them to a temp dir first. The reference project is a local
  Defold project whose path contains a space (keep it that way in tests); pass it to `scripts/fetch-corpus.ts` or
  set `DEFOLD_LOCAL_PROJECT`.
- MCP stdio: never write to stdout from server code; log with `src/util/log.ts` (stderr).
- Tool names and input schemas live in `mcp/src/tools/schemas.ts`; skills and evals depend on them.
- Keep tool output compact (results are capped at ~24k chars); page long content.
- Headless builds go to `build/agent`, never the editor's `build/default`.
- Skill text is our own wording; do not paste Defold manuals (they are fetched at runtime by the `docs` tool).
