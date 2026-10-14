---
"@furrow/cam-core": minor
"@furrow/web": minor
---

The imported drawing is aligned to the stock at the XY zero's anchor (ADR-0022). Importing a file places the drawing's bounding box on the stock at the current anchor (at the bottom-left corner for a custom zero), whatever its origin in the file, and choosing an anchor re-aligns it, moving the profiles' tab positions with it, as one undo step; choosing the current anchor aligns a drawing that isn't. Resizing the stock moves the drawing with an anchored zero, so an aligned drawing stays aligned. Setting a custom zero leaves the drawing where it is, and so does resizing the stock under one. Snapping to a shape's bounding box uses its exact bounds. A project holds one imported file for now: Import is disabled while it has shapes. SVG files with no page size are no longer moved onto y = 0 and no longer warn about it. `@furrow/cam-core` adds `pathBounds`, `shapesBounds`, `anchorPoint`, `anchorAlignment`, `alignShapes`, `xyOriginShift`, `translatePoint`, `translatePath`, `translateShape` and `translateShapes`.
