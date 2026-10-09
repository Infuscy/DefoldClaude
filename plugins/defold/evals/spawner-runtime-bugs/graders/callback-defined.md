---
type: llm
focus: { source: file, path: main/spawner.script }
---

PASS if the callback passed to timer.delay in init refers to a function that exists when init runs: a local function defined (or forward-declared with `local name`) above init, an inline function, or a function stored on self or a module before the call.
FAIL if init still passes a local function that is only declared further down the file.
