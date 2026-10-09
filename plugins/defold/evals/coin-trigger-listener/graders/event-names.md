---
type: regex
target: { source: file, path: main/player.script }
pattern: 'trigger_event|collision_event|contact_point_event'
---

Listener events are trigger_event / collision_event / contact_point_event, not the *_response message names.
