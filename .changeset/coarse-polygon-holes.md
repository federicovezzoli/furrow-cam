---
"@furrow/cam-core": patch
---

Drilling recognises large circles exported as coarse polygons, such as the 24-gons of Inkscape's R12 DXF, as holes: an outline may now stray from its circle by 1% of the radius when that is more than 0.1 mm.
