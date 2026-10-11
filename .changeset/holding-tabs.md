---
"@furrow/document": minor
"@furrow/cam-core": minor
"@furrow/web": minor
---

Holding tabs on profiles. A profile's `tabs` (or `null`) hold a width, a height above the final depth and explicit positions; each tab goes to the nearest closed contour, where the depth passes and finish pass that would cut below the tab top rise straight up over it and come back down (ramping at the plunge angle when ramping is on), and no contour starts on a tab. In the Properties panel, "Holding tabs" adds four per contour; tabs can be placed again per contour or by spacing, and are drawn in the viewport as the material they leave (the tab's width along the contour, the tool's slot across, the tab's height up from the final depth). Edit them in the top view: click a contour to add one, drag one to move it along the contours, click one to remove it. `@furrow/cam-core` adds `autoTabPositions`, `closedLoops`, `nearestOnLoops` and `tabFrame`.
