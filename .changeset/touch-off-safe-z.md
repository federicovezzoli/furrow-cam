---
"@furrow/post": patch
"@furrow/workspace": patch
---

Custom G-code blocks, the machine's and a touch-off pad's tool change, can now use `{safeZ}`, and **Suggest** rises to it, so the exported program retracts to the machine's current safe Z instead of the one set when Suggest was clicked. If you clicked Suggest before this release, click it again to pick this up. A placeholder the post can't fill in, such as a misspelt `{safez}`, now warns at export.
