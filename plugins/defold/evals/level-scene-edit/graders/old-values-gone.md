---
type: regex
target: { source: file, path: main/level.collection }
pattern: '(group|mask): \\\\\\"default'
match: not_contains
---
