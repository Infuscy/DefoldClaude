---
name: new-project
description: Create a new Defold project from an official template.
disable-model-invocation: true
argument-hint: "[template] [folder] [title]"
---

Create a new Defold project. Arguments: `$ARGUMENTS` (template, target folder, title; any may be missing).

1. If the template is missing, offer the choices: `empty` (works offline), `mobile`, `desktop`, `basic-3d`,
   `platformer`, `html5-poki`, `native-extension`, `rive`. Ask which one and where to create it if unclear.
2. Call `new_project` with the template, an empty or new folder, and the title.
3. Run `build` on the new project (pass `project=<folder>`) to confirm it compiles, then summarize the structure
   (`game.project` settings, main collection, scripts) and suggest a first step.
