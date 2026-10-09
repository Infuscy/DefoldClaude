---
type: llm
focus: { source: file, path: main/main.collection }
---

PASS if the player's collision object and the coin's collision object can detect each other: the player's mask includes the coin's group and the coin's mask includes the player's group (group and mask values appear inside the escaped embedded data or in referenced .collisionobject files).
FAIL if either mask leaves out the other object's group, or if one of the two objects has no collision object.
