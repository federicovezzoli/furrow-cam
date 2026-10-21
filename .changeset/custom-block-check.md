---
"@furrow/post": minor
"@furrow/ui": patch
---

Export now reads back the machine's custom G-code blocks and warns, with the line number, when one moves the tool into material or below the stock bottom, or when it can't be followed (e.g. `G53`) and the rest of the program isn't checked.
