---
type: llm
---

PASS if the solution keeps the player from reacting to input while the menu is open, for example the GUI script acquires input focus and returns true from on_input while the menu is visible (consuming the input), or the player script ignores input while a paused flag is set.
FAIL if nothing stops the player from receiving input while paused.
