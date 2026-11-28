---
"@furrow/post": patch
"@furrow/workspace": patch
---

The simulator now follows custom blocks that zero the machine where it stands (`G10 L20`), probe, retract, home an axis (`$HZ`) or run a controller macro, instead of stopping, and no longer warns about `M62`–`M65` outputs such as a spindle wired to a pin.
