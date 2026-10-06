---
description: Diagnose comparing message_id with a plain string
max_turns: 15
allowed_tools: [Read, Glob, Grep, Skill]
tags: [knowledge, debugging]
---

My Defold collision handler never runs, even though the physics debug view shows the objects touching. Here is the script:

```lua
function on_message(self, message_id, message, sender)
    if message_id == "contact_point_response" then
        print("hit", message.other_id)
        go.delete()
    end
end
```

What is wrong and what is the fix?
