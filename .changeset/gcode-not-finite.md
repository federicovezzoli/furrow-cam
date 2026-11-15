---
"@furrow/post": patch
"@furrow/ui": patch
---

Exporting G-code now fails with a message naming the operation if a toolpath ever has a coordinate or feed that isn't a number, instead of writing `NaN` into the program for the machine to stop on.
