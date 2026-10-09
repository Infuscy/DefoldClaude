---
type: regex
target: { source: file, path: main/enemy.go }
pattern: 'z: 3'
match: not_contains
---

The enemy sprite started at z 3, outside the default render range (-1..1), so spawned enemies were invisible.
