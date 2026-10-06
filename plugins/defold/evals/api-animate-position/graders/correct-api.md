---
type: llm
---

PASS if the Lua code calls go.animate with the "position" property (or a vmath.vector3 target for "position"), a go.PLAYBACK_ONCE_FORWARD playback, a go.EASING_OUT* easing constant, duration 2, and a completion callback function that prints "arrived".
FAIL if it uses functions that do not exist in Defold (for example go.move_to, go.tween, transition.to, Tween.new) or omits the completion callback.
