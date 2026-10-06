---
name: check
description: Check the whole Defold project for problems without changing anything.
disable-model-invocation: true
---

Review the Defold project in the current workspace without modifying files.

1. `status`: note the Defold version, the editor state and the dependencies.
2. `validate` with no paths (the whole project). Group findings by file; separate errors from warnings.
3. `build` to confirm what the compiler reports (it catches things validation cannot, such as missing atlas
   animations).
4. Report a short table: problem, file:line, why it matters, suggested fix. Do not edit files unless the user asks.
