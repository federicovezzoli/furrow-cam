---
"@furrow/cam-core": minor
---

Add the geometry kernel adapter on Clipper2 (`clipper2-ts`, ADR-0015): `offset` (round, miter or square joins, arcs within 0.01 mm by default, input resolved with a fill rule so any winding gives counter-clockwise outer boundaries), `union`, `difference`, `intersection`, `nest` (groups rings into outer boundaries and holes by nesting, whatever their winding), `containment` (inside, outside or on the boundary) and `signedArea`, all on millimetre `[x, y]` rings at a precision of 0.0001 mm.
