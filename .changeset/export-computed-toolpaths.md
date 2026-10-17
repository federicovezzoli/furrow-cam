---
"@furrow/post": minor
"@furrow/web": patch
---

Exporting G-code reuses the toolpaths the workspace has already computed instead of computing every one again, so a project with 3D operations exports at once.
