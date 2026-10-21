# ADR-0055: A project holds several drawings, each transformed by rewriting its points

- **Status:** Proposed
- **Date:** 2026-10-21
- **Deciders:** Federico Vezzoli
- **Related:** PRD-0009, PRD-0005 (S2), ADR-0007, ADR-0010, ADR-0014, ADR-0022, ADR-0031, ADR-0038

## Context

ADR-0022 and ADR-0031 allow one imported file per project: an SVG or DXF drawing, or an STL model. Import is off as soon as the project has one. A project is often made of several parts, such as a sign's outline, its lettering and a carved emblem, which come from different files. A drawing's size is set by the file alone (its units, or the DPI of an SVG), while a model can be resized and fitted to the stock (ADR-0031, ADR-0034, ADR-0038). PRD-0009 asks for several drawings per project, each one resizable. It will later ask for moving, mirroring, rotating and duplicating them.

`document.geometry` is a flat list of shapes in stock coordinates (ADR-0014). Nothing records which file a shape came from, except `Shape.source`, the file's name, which two imports of the same file share. Operations point at shapes by id. Profile tab positions and the touch-off pad are stored in stock coordinates and move with the design (ADR-0022, ADR-0043).

## Options considered

1. **A placement per drawing, like a model's.** Shapes stay in the file's coordinates, and a `Drawing` stores position, scale, rotation and mirroring. Pros: transforms are not destructive and work like a model's. Cons: everything that reads geometry has to apply the transform first: toolpaths, the viewport, path picking, snapping, tabs, bounds and alignment. Tab positions and picked points would need to be stored in drawing coordinates as well.
2. **Transform by rewriting the points.** A `Drawing` groups shapes, and a transform rewrites its shapes' points in stock coordinates, as aligning to an anchor already does (ADR-0022). Pros: whatever reads geometry stays as it is, and arcs and cubics stay exact under uniform scaling, rotation and mirroring. Cons: a transform can only be reversed with undo. Many rotations pile up rounding, which is kept to a nanometre as on import. Each transform copies the drawing's shapes into the undo history.

## Decision

Option 2.

- **Drawing:** `document.drawings` lists `{ id, name, border }`. `name` is the imported file's name. `border` is the space *Fit to stock* leaves around the drawing, as for a model (ADR-0038). Every shape has a `drawingId` that names an existing drawing, and every drawing has at least one shape. The schema validates both. `Shape.source` stays. The migration to the new schema version puts the shapes of an existing project into one drawing, named after the first shape's `source` (or "Drawing"), with a 10 mm border.
- **Several imports:** an SVG or DXF file can be imported into a project that already has drawings or models. An STL model can be imported into a project that has drawings. Each import of a drawing adds a new drawing. As in ADR-0022, it is aligned on its own to the stock at the XY zero's anchor, or at the bottom-left corner when the zero is custom, so it may overlap what is already there. Importing a model is unchanged (ADR-0031).
- **Transforms** rewrite the shapes of one drawing in one undo step, with one assignment of `draft.geometry` as in ADR-0022. They also move every tab position that lies on one of that drawing's paths, so a profile's tabs stay on the shapes they were placed on. Coordinates are rounded as on import. Toolpaths, posts, the viewport, picking and snapping still read stock coordinates as before.
- **Size:** width and height scale the drawing uniformly, so it keeps its proportions. The drawing's point at the zero's anchor stays where it is (at bottom-left for a custom zero), as for a model (ADR-0031). *Fit to stock* scales the drawing to fit inside the stock less its border and aligns it at the anchor. A scale preserves arcs (centre and radius scale with the points) and cubics.
- **Removing a drawing** removes its shapes and the operation targets that point at them, in one undo step. An operation left with no targets is removed too, as a model's operations are removed with the model.
- **Design alignment is unchanged:** choosing an anchor or resizing the stock moves every drawing and model together by the bounding box around all of them (ADR-0022, ADR-0031).

Moving, mirroring, rotating and duplicating build on the same pieces: a drawing to select, and a transform of its points that brings its tabs along. Their UI is left to follow-up issues. A mirror reverses the order of a path's points and so its winding. Operations must not depend on that winding, and the issue that adds mirroring must check that they don't.

This supersedes the rules in ADR-0022 and ADR-0031 that a project holds one imported file. Everything else in both ADRs stands.

## Consequences

- A project can combine drawings from several files with models. Existing projects open with one drawing.
- A drawing's size, and later its position and orientation, can only be reversed with undo. Re-importing the file brings back the original.
- A transform copies the drawing's shapes into the undo history, as aligning to an anchor already does. This is acceptable at the sizes PRD-0001 targets.
- A tab placed exactly where paths of two drawings meet moves with the first drawing it lies on.
- Scaling a drawing changes the size of circles that drill operations match against the tool's diameter (ADR-0007), so some may no longer drill.
