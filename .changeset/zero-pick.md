---
"@furrow/cam-core": minor
"@furrow/web": minor
---

Pick the XY zero in the viewport (PRD-0002 Z5, Z9). With a custom zero, **Pick in viewport** in the stock properties switches to the top view and enters pick mode (crosshair cursor; Esc or a right-click without dragging cancels). The cursor snaps within 10 pixels to the 9 stock anchors, shape vertices, arc centres, circle centres (closed paths drilling takes as circles, drawn as arcs, polygons or Béziers) and shape bounding-box corners and centres; the target is ringed and labelled with its kind and its X/Y from the stock's bottom-left corner in project units. Clicking sets a custom zero there as one undo step (a free point where nothing is in reach) and leaves pick mode. `@furrow/cam-core` adds `snapTargets`, `nearestSnapTarget` and `circleCenter`.
