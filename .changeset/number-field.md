---
"@furrow/cam-core": minor
"@furrow/web": minor
---

Add unit-aware number fields. Every numeric field accepts a number or a simple expression with an optional unit (`6.35`, `6.35mm`, `1/4in`, `1/4"`, `10/2`, `100 in/min`), steps with the arrow keys (Shift ×10, Alt ×0.1) and scrubs when its label is dragged sideways; counts and spindle speeds take whole numbers only. Values are stored in millimetres and shown in the project's units, which can now be switched between millimetres and inches in the workspace's Properties panel, next to the now editable stock size (a scrub, or an arrow key held down, is one undo step, and Escape cancels it). The tool and machine forms use the same fields, shown in millimetres. `@furrow/cam-core` gains `parseQuantity`, `formatQuantity`, `unitLabel`, `toInternal` and `fromInternal`, and exports `MM_PER_INCH`.
