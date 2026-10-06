---
name: build
description: Build the Defold project and fix the build errors.
disable-model-invocation: true
argument-hint: "[bob|editor]"
---

Build the Defold project in the current workspace with the `build` tool (backend: `$ARGUMENTS` if given,
otherwise auto).

1. Call `build`. If it succeeds, report the time and backend in one line and stop.
2. If there are errors: for each one read the referenced file around the reported line, find the cause and make
   the smallest correct fix (use `api` to confirm any Defold function you change, and `edit_resource` for scene
   files).
3. Build again. Repeat at most 3 times.
4. Summarize: what was wrong and what you changed (file:line), plus anything still failing with your best guess.
