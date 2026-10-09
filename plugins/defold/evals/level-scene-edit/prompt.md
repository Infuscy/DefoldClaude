---
description: Precise edits inside doubly escaped embedded components across five game objects
max_turns: 60
timeout_seconds: 1200
allowed_tools: [Read, Glob, Grep, Edit, Write, Skill, mcp__plugin_defold_defold__status, mcp__plugin_defold_defold__api, mcp__plugin_defold_defold__docs, mcp__plugin_defold_defold__read_resource, mcp__plugin_defold_defold__edit_resource, mcp__plugin_defold_defold__validate, mcp__plugin_defold_defold__build, mcp__plugin_defold_defold__run, mcp__plugin_defold_defold__logs, mcp__plugin_defold_defold__screenshot, mcp__plugin_defold_defold__inspect]
tags: [project, hard]
---

In main/level.collection, put every enemy's collision object in group "enemy" with mask "player" (replacing the current group and mask), make enemy_3 use the coin image instead of the hero image, and move enemy_5 to x = 560. Leave everything else unchanged, and make sure the project still builds.
