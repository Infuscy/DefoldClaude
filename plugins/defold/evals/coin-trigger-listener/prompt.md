---
description: Collectible coin via physics.set_event_listener and two collision objects
max_turns: 60
timeout_seconds: 1200
allowed_tools: [Read, Glob, Grep, Edit, Write, Skill, mcp__plugin_defold_defold__status, mcp__plugin_defold_defold__api, mcp__plugin_defold_defold__docs, mcp__plugin_defold_defold__read_resource, mcp__plugin_defold_defold__edit_resource, mcp__plugin_defold_defold__validate, mcp__plugin_defold_defold__build, mcp__plugin_defold_defold__run, mcp__plugin_defold_defold__logs, mcp__plugin_defold_defold__screenshot, mcp__plugin_defold_defold__inspect]
tags: [project, hard]
---

Make the coin collectible in this Defold game. Add a coin game object at (320, 220), right on top of the player, so I can test it straight away: as soon as the game starts the player overlaps the coin, so it should be collected immediately. Give the player and the coin collision objects, and handle the overlap with a physics world event listener set up in main/player.script (not with on_message). When the coin is collected, delete it and print "collected".
