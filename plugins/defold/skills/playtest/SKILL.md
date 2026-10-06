---
name: playtest
description: Playtest a feature of the running Defold game and report what works and what does not.
disable-model-invocation: true
argument-hint: "[what to test]"
---

Playtest the Defold game in the current workspace. What to test: $ARGUMENTS (if empty, test the core loop of the game).

Delegate the session to the `defold-playtester` agent so screenshots and logs stay out of this conversation. Give it
the feature to test, what "working" means, and anything you already know about controls (input bindings, GUI buttons).
When it reports back, summarise the findings for the user with the evidence it collected (log lines, Lua errors,
screenshot observations) and propose concrete fixes for anything broken.
