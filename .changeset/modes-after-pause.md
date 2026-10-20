---
"@furrow/post": patch
---

G-code now sets millimetres and absolute coordinates again after each tool-change pause, so a probe macro or jog that leaves G91 or G20 behind can't make the next moves relative or in inches.
