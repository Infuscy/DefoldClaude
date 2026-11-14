---
name: check
description: Check the whole Defold project for problems without changing anything.
disable-model-invocation: true
---

Review the Defold project in the current workspace without modifying files.

1. `status`: note the Defold version, the editor state and the dependencies.
2. `validate` with no paths (the whole project). Group findings by file; separate errors from warnings. It also
   checks across files for mistakes a build accepts: animation names that are not in their atlas, `action_id`
   values no input binding produces, misspelled built-in message names.
3. `build` to confirm what the compiler reports (it catches things validation cannot, such as shader compile
   errors and broken image or font files).
4. Report a short table: problem, file:line, why it matters, suggested fix. Do not edit files unless the user asks.
