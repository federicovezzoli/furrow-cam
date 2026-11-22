---
"@furrow/post": minor
"@furrow/ui": patch
"@furrow/mcp": patch
---

Exporting G-code now warns when the program needs more travel than the machine profile has, so a job too big for the machine is caught before it runs into the end stops.
