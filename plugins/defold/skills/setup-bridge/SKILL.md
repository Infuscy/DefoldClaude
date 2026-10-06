---
name: setup-bridge
description: Add Defold's Automation Bridge extension to the project so Claude can click, type and take in-engine screenshots in the running game.
disable-model-invocation: true
---

Set up Defold's official Automation Bridge (https://github.com/defold/extension-automation-bridge) in the current
Defold project, so the `input` tool and in-engine screenshots work.

1. Explain briefly to the user what this adds before changing anything:
   - a library dependency in `game.project` (a native extension, active in debug builds only and stripped from release builds);
   - builds with native extensions are compiled on Defold's cloud build server (`build.defold.com`), so the first
     build takes longer and needs network access;
   - while a debug game runs, its engine service (and the bridge's HTTP endpoints) can be reachable on the local network.
   Ask for confirmation and continue only if the user agrees.
2. Find the latest release tag (for example with `gh api repos/defold/extension-automation-bridge/releases/latest --jq .tag_name`,
   or fall back to 2.5.0) and add
   `dependencies#N = https://github.com/defold/extension-automation-bridge/archive/refs/tags/<tag>.zip`
   under `[project]` in `game.project`, using the next free index N. Keep existing dependencies.
3. Run `build command=resolve` to fetch it, then `run action=restart` (or `start`). The run log should contain
   `AUTOMATIONBRIDGE: Automation Bridge endpoint registered`.
4. Confirm with `inspect elements=true` and report what the user can now ask for (e.g. "play the first level and
   tell me if the jump works").
