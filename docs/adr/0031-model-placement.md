# ADR-0031: Models are placed by quarter turns, a scale and a depth, and aligned with the drawing

- **Status:** Proposed; superseded in part by [ADR-0034](0034-model-keeps-proportions.md) (one scale for X, Y and Z; no cap on import), [ADR-0038](0038-roughing-margin-and-model-border.md) (import and *Fit to stock* leave a border), [ADR-0055](0055-several-drawings-transformed-in-place.md) (several imported files per project) and [ADR-0060](0060-two-sided-projects.md) (two-sided projects machine a model from below too)
- **Date:** 2026-10-15
- **Deciders:** Federico Vezzoli
- **Related:** PRD-0005 (S2, S3), ADR-0014, ADR-0016, ADR-0022, ADR-0029, ADR-0030; issue #114

## Context

PRD-0005 S2 places an imported STL model on the stock: turned in 90° steps about each axis, scaled uniformly or fitted to the stock, sunk to a depth with its top at the stock top, and positioned relative to the zero point like the drawing. The mesh itself is a project asset (ADR-0029), so the document holds only what places it. ADR-0022 aligns the drawing's bounding box to the stock at the zero's anchor, and moves the drawing when an anchor is chosen or the stock is resized. A model is often part of the same design as the drawing, such as an emblem inside a sign's outline.

Relief tools usually set a model's height on its own: a downloaded relief may be modelled any depth, and the stock decides how deep it can go (PRD-0005's user flow sets a width of 200 mm and a depth of 12 mm).

## Options considered

1. **A full transform matrix in the document**: any rotation and scale. Pros: general. Cons: arbitrary rotations aren't wanted (the model is cut from the top), and a matrix is hard to validate and to edit with fields.
2. **Quarter turns, an XY scale, a depth and a position**: what the UI edits, stored as it is. Pros: every stored placement is valid, the fields map to the controls, and the transform is computed from them. Cons: the turns are stored as three angles, so turning about one axis after another needs composing.
3. **Align each model on its own when an anchor is chosen**: Pros: simple. Cons: a model placed relative to the drawing comes apart from it.
4. **Align the drawing and the models as one design**: Pros: they keep their places relative to each other. Cons: a model far from the drawing changes where the drawing lands.

## Decision

Options 2 and 4:

- **Placement** (`Model.placement` in `@furrow/document`): `rotation` holds quarter turns about the stock's X, then Y, then Z axes. The UI turns the model about the stock's axes (`turnModel`), so each new turn is composed with the stored ones and stored again as three angles. `scale` applies to X and Y alike, so the outline keeps its proportions. `depth` is how far the model reaches from the stock top: the rotated mesh's height is stretched or squashed to it, independently of `scale`. `position` is the bottom-left corner of the placed model's bounding box, in stock coordinates (ADR-0014). The top of the model is always at the stock top (`z = 0`). A model whose rotated mesh is flat sits on the stock top.
- **One imported file**: as ADR-0022 allows one drawing per project for now, a project holds one imported file, either an SVG or DXF drawing or an STL model. Import is off once it has one; removing the model or undoing the import brings it back.
- **Import**: a new model is unrotated, scaled to fit the stock's width and height, its depth what that scale gives but no deeper than the stock, and aligned to the stock at the zero's anchor, or at its bottom-left corner when the zero is custom.
- **Editing**: turning or scaling keeps the model's point at that anchor where it is, so an aligned model stays aligned. *Fit to stock* scales it to the stock again and aligns it. The position fields show and set that point's distance from the zero.
- **Design alignment**: choosing an anchor aligns the drawing and the models together, by the bounding box around all of them (`designAlignment`), and moves them by the same offset in one undo step. Resizing the stock moves the models with an anchored zero, as it moves the drawing (ADR-0022). A custom zero moves neither. Importing a drawing still aligns only its shapes (ADR-0022).
- **Viewport**: a model is drawn as it will be cut (PRD-0005 S3): its rotated mesh rasterised from above into a heightmap (ADR-0030's z-buffer, `modelHeightmap`, at most 1024 × 1024 cells), so undercuts and overhangs are filled, then scaled and moved by the rest of its placement. Only turning a model draws it again. The work is done in a Web Worker (ADR-0004), which keeps recently read meshes; files are cached in the browser's Cache Storage by hash.

This extends ADR-0022: the bounding box an anchor aligns now covers the models as well as the shapes.

## Consequences

- Every placement the schema accepts is one the UI can show and edit; no transform is stored, so toolpaths (ADR-0030) compute it from the placement (`modelTransform`).
- A model's height can differ from its scaled height, which some users may not expect; the depth field shows it next to the size.
- Choosing an anchor may move the drawing differently once models are added, because the design's bounding box grows.
- The zero picker's snap targets don't include models yet.
- A drawing and a model can't be imported into the same project yet, so a sign with a carved emblem needs a follow-up issue. Placement and design alignment already handle both, so lifting the rule only changes import.
