---
description: Pause menu GUI with nested nodes, an Escape binding, picking and system exit
max_turns: 60
timeout_seconds: 1200
allowed_tools: [Read, Glob, Grep, Edit, Write, Skill, mcp__plugin_defold_defold__status, mcp__plugin_defold_defold__api, mcp__plugin_defold_defold__docs, mcp__plugin_defold_defold__read_resource, mcp__plugin_defold_defold__edit_resource, mcp__plugin_defold_defold__validate, mcp__plugin_defold_defold__build, mcp__plugin_defold_defold__run, mcp__plugin_defold_defold__logs, mcp__plugin_defold_defold__screenshot, mcp__plugin_defold_defold__inspect]
tags: [project, hard]
---

Add a pause menu to this Defold game in main/pause.gui with its logic in main/pause.gui_script. Pressing Escape toggles it. It shows a centred, semi-transparent dark panel with the title "Paused" and two buttons, "Resume" and "Quit", placed inside the panel. Clicking Resume closes the menu; clicking Quit exits the game. While the menu is open the player must not react to input. Keep everything building.
