---
"@furrow/post": minor
---

Exported GRBL programs now describe each tool's cutter shape in a `(Furrow tool: …)` comment where the bit is in the spindle, so the G-code simulation can read it back. GRBL ignores comments, so the machine runs the program as before.
