---
description: Find two bugs that only show at runtime (nil timer callback, sprite outside the visible z range)
max_turns: 60
timeout_seconds: 1200
allowed_tools: [Read, Glob, Grep, Edit, Write, Skill, mcp__plugin_defold_defold__status, mcp__plugin_defold_defold__api, mcp__plugin_defold_defold__docs, mcp__plugin_defold_defold__read_resource, mcp__plugin_defold_defold__edit_resource, mcp__plugin_defold_defold__validate, mcp__plugin_defold_defold__build, mcp__plugin_defold_defold__run, mcp__plugin_defold_defold__logs, mcp__plugin_defold_defold__screenshot, mcp__plugin_defold_defold__inspect]
tags: [project, hard]
---

Enemies should spawn at the top of the screen every second and fall down, but I never see a single one. The project builds without errors. Find out what is wrong and fix it.
