---
"@furrow/cam-core": minor
"@furrow/web": minor
---

The imported drawing is aligned to the stock at the XY zero's anchor (ADR-0022). Importing a file places the drawing's bounding box on the stock at the current anchor (at the bottom-left corner for a custom zero), whatever its origin in the file, and choosing an anchor or resizing the stock re-aligns it, moving the profiles' tab positions with it, as one undo step. Setting a custom zero leaves the drawing where it is, and so does resizing the stock under one. A project holds one imported file for now: Import is disabled while it has shapes. SVG files with no page size no longer warn about where the drawing was placed. `@furrow/cam-core` adds `pathBounds`, `shapesBounds`, `anchorPoint`, `anchorAlignment`, `translatePoint`, `translatePath` and `translateShape`.
