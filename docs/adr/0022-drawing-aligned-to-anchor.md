# ADR-0022: The drawing is aligned to the stock at the zero's anchor

- **Status:** Proposed
- **Date:** 2026-10-14
- **Deciders:** Federico Vezzoli
- **Related:** PRD-0002 (Z1, Z3, Z4–Z6, Z9), PRD-0001 (R1, R2, R3), ADR-0014, ADR-0016, ADR-0010; issue #91

## Context

ADR-0014 stores geometry in stock coordinates, where `(0, 0)` is the stock's bottom-left corner. ADR-0016 keeps that for the 9 anchors and the custom zero. Both say that changing the zero only moves the zero marker, never the design. The importers put the file's origin (DXF `(0, 0)`, an SVG page's bottom-left corner) on the stock's bottom-left corner.

So where a drawing lands depends on how it was drawn. A part drawn around its own `(0, 0)` hangs off the stock, and an SVG drawn in the middle of its page lands in the middle of nowhere. Choosing the `center` zero doesn't bring the stock and the drawing together. Users expect the anchor to say how the drawing sits on the stock: with `bottom_left`, the drawing's bottom-left corner is on the stock's bottom-left corner, which is where the machine is zeroed. With `center`, the drawing is centred on the stock (#91).

A custom zero is different. It is picked on something already on the stock, such as a hole centre or a fixture corner (PRD-0002 Z4–Z6). There the drawing must stay where it is.

## Options considered

1. **Keep stock coordinates and translate when aligning**: import and choosing an anchor translate the stored shapes and the profile tab positions so the drawing's bounding box sits at the anchor. This needs no schema change or migration, and toolpaths, posts, the viewport and snapping stay as they are. The cost: choosing an anchor rewrites the whole geometry, so its undo step holds a copy of it.
2. **Store XY in work coordinates** (ADR-0014's option 1): this needs a schema version bump and a migration of every stored point, and the viewport, toolpaths, posts and snapping change frame. It would still need to translate when aligning, because the drawing's position relative to the zero depends on its bounding box.

## Decision

Option 1. Geometry stays in stock coordinates (ADR-0014), and `stockOffset(stock)` still turns them into work coordinates. On top of that:

- **Alignment:** the drawing's bounding box covers all shapes together, with arcs and curves measured exactly where they bulge past their end points (`shapesBounds`). Snapping uses the same exact boxes for its bounding-box targets. It is placed on the stock at the same anchor as the XY zero (`anchorAlignment`). The zero is then both that point of the stock and that point of the drawing. The file's own origin doesn't affect placement, so importers only need to get the shapes' positions relative to each other right.
- **Import:** the drawing is aligned at the current anchor, or at the bottom-left corner when the zero is custom. A project holds one imported file (SVG or DXF) for now, and import is disabled while it has shapes. Undoing the import or starting a new project are the ways to bring in another file until shapes can be removed.
- **Choosing an anchor**, from the picker or by snapping to a stock anchor in the viewport: the zero moves to the anchor, and the drawing and the profiles' tab positions are re-aligned to it in the same undo step (Z9). Choosing the anchor already selected aligns a drawing that isn't, such as one in a project saved before this decision, and otherwise changes nothing. Switching from a custom zero to an anchor re-aligns too.
- **Resizing the stock:** an anchored zero follows the stock (Z3), and the drawing moves with it in the same undo step, by as far as the zero moved (`xyOriginShift`). An aligned drawing stays aligned, so the stock grows or shrinks around it. A drawing that isn't aligned keeps its place relative to the zero instead of jumping to the anchor. With a custom zero, or when only the thickness changes, the drawing does not move.
- **Custom zero** (typed or picked): only the zero moves, and the drawing stays where it is (Z4–Z6).
- Translated coordinates are rounded like imported ones (to a nanometre), so re-aligning back and forth doesn't pile up float noise. The geometry is replaced in one assignment, so the undo step is one patch rather than one per point.

This supersedes the parts of ADR-0014 and ADR-0016 that say changing the zero never moves the design on the stock, and ADR-0014's statement that importers place the file's origin on the stock's corner. Everything else in both ADRs stands.

## Consequences

- Choosing an anchor changes the G-code: the drawing is measured from the same anchor of its own bounding box.
- The viewport is still in stock coordinates. When an anchor changes, the stock stays put on screen and the drawing moves to its new place.
- Choosing an anchor or resizing the stock copies the whole geometry into the undo history, and a gesture that resizes continuously makes one copy per change. This is acceptable at MVP sizes.
- A future operation parameter stored in stock coordinates must move with the drawing (`moveDrawing` in the workspace's stock actions).
- Removing the drawing, or importing more than one file, needs a follow-up issue.
