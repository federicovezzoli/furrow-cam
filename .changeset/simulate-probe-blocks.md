---
"@furrow/post": patch
"@furrow/workspace": patch
---

The simulator now follows program-start and tool-change blocks that zero the machine where it stands (`G10 L20`), probe, and retract, instead of stopping with "moves without G0, G1, G2 or G3".
