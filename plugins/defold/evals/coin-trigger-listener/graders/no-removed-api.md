---
type: regex
target: { source: file, path: main/player.script }
pattern: 'physics\.set_listener\s*\('
match: not_contains
---

physics.set_listener does not exist in Defold 1.13; calling it is a runtime error.
