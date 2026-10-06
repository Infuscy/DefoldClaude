---
name: run
description: Build and run the Defold game, then report errors and what is on screen.
disable-model-invocation: true
argument-hint: "[bob|editor]"
---

Run the Defold game in the current workspace and show the user what happens.

1. `run action=start` (backend: `$ARGUMENTS` if given, otherwise auto) with `wait_seconds=3`.
2. If the build failed, list the errors and offer to fix them (the `defold-run-debug` skill has the workflow).
3. If it started: report Lua errors from the run result, then take a `screenshot` and describe what is visible.
   Mention anything that looks wrong (blank screen, missing objects, errors in `logs level=error`).
4. Leave the game running and tell the user it can be stopped with `run action=stop`.
