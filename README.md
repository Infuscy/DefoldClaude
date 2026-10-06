# Defold for Claude Code

A Claude Code plugin that makes Claude effective at building games with the [Defold](https://defold.com) engine.

- **Knows the engine**: a `defold` skill plus API lookup from *your installed* Defold version's docs, and the
  official manuals/examples.
- **Edits scene files safely**: structured read/edit of `.collection`, `.go`, `.gui`, `.atlas`, … (including the
  nested escaped data of embedded game objects and components), validated against Defold's schemas.
- **Closes the loop**: build, run, logs, screenshots and runtime scene inspection — through the open Defold editor
  (its HTTP API) or headless with bob + dmengine.

> Status: under active development (milestone M0). See `CLAUDE.md` for the developer guide.

## Install

From a clone of this repository:

```bash
claude plugin marketplace add C:\GIT\DefoldClaude
```

```bash
claude plugin install defold@defold-tools
```

Requirements: Node.js 20+ on `PATH`, and the Defold editor installed (auto-detected; otherwise set the plugin option
`defold_path`).
