---
"@furrow/cam-core": minor
"@furrow/web": minor
---

Pick the XY zero in the viewport (PRD-0002 Z5, Z9). With a custom zero, **Pick in viewport** in the stock properties switches to the top view and enters pick mode (crosshair cursor; Esc or a right-click without dragging cancels). The cursor snaps within 10 pixels to the 9 stock anchors, shape vertices, arc centres, circle centres (closed paths drilling takes as circles, drawn as arcs, polygons or Béziers) and shape bounding-box corners and centres; the target is ringed and labelled with its kind and its X/Y from the stock's bottom-left corner in project units. Clicking puts the zero where shown, as one undo step, and leaves pick mode: on the anchor itself for a stock anchor, so it follows the stock when resized, otherwise on a custom zero (at the cursor where nothing is in reach). The snap follows the camera as it pans and zooms under a still cursor, and pick mode ends when the zero stops being custom (an undo, an anchor chosen). `@furrow/cam-core` adds `snapTargets`, `nearestSnapTarget` and `circleCenter`.
