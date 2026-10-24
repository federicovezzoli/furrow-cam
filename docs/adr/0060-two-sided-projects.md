# ADR-0060: Two-sided projects flip the stock about its centre line, and the bottom side has its own stock coordinates

- **Status:** Proposed
- **Date:** 2026-10-24
- **Deciders:** Federico Vezzoli
- **Related:** PRD-0011 (B1, B2), ADR-0003, ADR-0014, ADR-0016, ADR-0030, ADR-0031, ADR-0034; #354. Extends ADR-0031: a model is no longer machined from the top only.

## Context

PRD-0011 cuts a model from both faces of the stock: the top side, then the stock is turned over on locating pins and the bottom side is cut, each side down to a parting height. Today everything is in one frame, the stock coordinates of ADR-0014 (`(0, 0)` the stock's bottom-left corner, `z = 0` its top), and a model hangs from the stock top (ADR-0031). The document needs to say whether a project is two-sided, about which axis the stock is turned, where the sides part, and which side each operation cuts; and the toolpaths, viewport and export issues that follow (#355, #356, #358, #359, #360) need one rule for where things are once the stock is turned over.

## Options considered

1. **Store everything in the top side's coordinates**, and have each bottom-side toolpath mirror its output. Pros: one frame. Cons: every generator, the simulation and the post-processor each need to know about the flip, and the bottom side's G-code has to be mirrored after the fact.
2. **Give the bottom side its own stock coordinates**, derived from the top side's by the flip, and map models and drawings into them before toolpaths are computed. Pros: every generator, the heightmap, the simulation and the zero work unchanged on either side. Cons: a helper must map between the two frames, and the document holds only the top side's.
3. **The parting plane as a height above the stock's bottom face.** Pros: reads as "height". Cons: a model hangs from the stock top, so changing the stock's thickness would move the parting plane through the model.
4. **The parting plane as a depth below the stock top**, as model and operation depths are measured. Pros: it stays at the same place in the model when the stock gets thicker. Cons: the PRD calls it a height.

## Decision

Options 2 and 4:

- **Setting** (`Stock.twoSided` in `@furrow/document`): `null` for a project cut from the top only, else `{ flipAxis, partingDepth }`. `flipAxis` is `"x"` or `"y"`: the stock is turned over by half a turn about the line through its centre parallel to that axis, the only flips PRD-0011 allows. `partingDepth` is how far the parting plane is below the stock top (the PRD's parting height), greater than zero and less than the stock's thickness. A stock made thinner than that allows keeps the plane at the same fraction of its thickness. It is a single flat plane; whether it should follow the model's silhouette is left to #357. It lives on the stock because it describes the stock's setup, like the zero and the touch-off pad (ADR-0016).
- **Operation side** (`Operation.stockSide`, named so it is not taken for a profile's `params.side`): `"top"` or `"bottom"`, `"top"` for new operations and for every operation in documents saved before (schema version 20). A one-sided project has no bottom side: a bottom-side operation there is invalid.
- **Bottom-side coordinates**: once the stock is turned over, `(0, 0)` is again the bottom-left corner of the face in view and `z = 0` that face. A point `(x, y, z)` of the top side is at `(x, height − y, −thickness − z)` on the bottom side for a flip about X, and at `(width − x, y, −thickness − z)` for a flip about Y (`flipPoint`, `flipTransform` in `@furrow/cam-core`). Half a turn is its own inverse, so the same map goes back.
- **Zero**: the bottom side uses the stock's XY and Z origins unchanged, in its own coordinates. The stock is turned over in place about its centre line, so its footprint on the machine doesn't move and the machine's XY zero stays where it was; Z is zeroed on the face in view, as on the top side. Pins (#356) and edges (#361) only decide how the turned-over stock is lined up with that footprint.
- **Models**: a model's placement stays in the top side's coordinates. Seen from below it is the flip of its placed mesh (`bottomModelTransform`, the flip applied after `modelTransform`), so it reaches up from the bottom side's floor rather than hanging from its top. In a two-sided project a model may reach the full stock thickness, as ADR-0034 already lets it: nothing in the document caps a model's depth. Drawings are seen from below the same way, mirrored about the flip axis, when 2D operations go on the bottom side (#360).
- **Default parting depth**: half the deepest model's depth, or half the stock's thickness with no model, when the user turns two-sided on (#358).

## Consequences

- Toolpath generators, the heightmap rasteriser and the post-processor stay as they are: bottom-side operations get their model or shapes mapped into the bottom side's coordinates first.
- Each side's toolpaths, simulation and G-code are in that side's own frame, so the viewport shows the bottom side turned over and the export writes one file per side (#358, #359).
- The stock must be turned over about its centre line for the zero to carry over; pins on the flip axis guarantee it, and the setup header (#359) says so.
- Resizing the stock moves the bottom side's view of a model and of the drawings, since the flip is about the stock's centre.
