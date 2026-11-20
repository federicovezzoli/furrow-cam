# ADR-0087: A pattern is a drawing that keeps its settings and its boundary, and stores its cells as one shape

- **Status:** Accepted; superseded in part by [ADR-0088](0088-pattern-panel-offers-only-its-settings.md) (a pattern isn't transformed on its own)
- **Date:** 2026-11-19
- **Deciders:** Federico Vezzoli
- **Related:** PRD-0016 (P1–P5, P8, P9), ADR-0004, ADR-0018, ADR-0055, ADR-0059, ADR-0080; #621–#624

## Context

PRD-0016 adds patterns: cells (hexagons, waves, Voronoi cells…) tiled inside closed paths already in the project and clipped to them, which stay editable (P5) and follow their boundary when it moves, turns, mirrors or changes size, cells keeping their size (P4). Operations that machine a pattern must keep their targets across these changes, and deleting the boundary must leave the pattern as a plain drawing (P8).

A text item has the same needs, and ADR-0059 settled them: a drawing that keeps its settings and stores its derived outlines as its one shape, in stock coordinates, so whatever reads geometry stays as it is (ADR-0055). What a pattern adds is a second input, its boundary, which lives in another drawing.

## Options considered

1. **Settings only, cells derived when read.** Every reader of geometry (toolpaths, the viewport, picking, the server's validation of targets) would generate the pattern first. Rejected for the reasons ADR-0059 rejected it for text, and generation can take a noticeable time (P7).
2. **Settings, a reference to the boundary's paths and the generated cells as the drawing's one shape.** As a text item, plus the boundary as path selections (`ShapePaths`, the type of an operation's target, ADR-0018). Pros: geometry readers, archives and `.furrow` files stay as they are; operations target the pattern's shape by id; the boundary is found again by id after any transform. Cons: the cells duplicate what the settings and the boundary describe, and the workspace must regenerate them whenever either changes.
3. **As option 2, but each cell its own shape**, so an operation can target part of the pattern (PRD open question). Cons: a 10 000-cell pattern becomes 10 000 shapes in the Objects pane, the undo patches and the targets list; shape ids can't survive a regeneration that changes the cell count, so operations would lose their targets on every edit.

## Decision

Option 2.

- **A pattern is a drawing with `pattern`:** `Drawing.pattern` holds `{ cell, size, gap, inset, amplitude, wavelength, seed, placement, boundary }` (`PatternSettings`). `cell` is the cell type (P6). `size` is a cell's width, or the spacing between a line pattern's lines. `gap` is the wall left between closed cells, taken off each cell as an inset; zero gives shared edges. `inset` keeps the pattern that far inside the boundary (P3). `amplitude` and `wavelength` shape waves and zigzags; `seed` makes Truchet arcs and Voronoi cells reproducible. Every field is always present, whatever the cell type, so switching cell types and back keeps the values. Lengths are millimetres. A drawing has at most one of `text` and `pattern`. Everything ADR-0055 and ADR-0080 say of drawings (selecting, hiding, locking, the Objects pane, removing) holds for patterns.
- **The boundary is a list of path selections of one other drawing:** `boundary` lists shapes, each whole or some of its paths, as an operation's targets do. They all belong to one drawing (P1; the PRD's open question on boundaries across drawings is answered no), which is not a pattern, so patterns never chain. Closed paths count even-odd, so a counter or a frame's inside stays empty; a whole shape's open paths are ignored, and paths picked by index must be closed. The schema checks that the shapes and paths exist. Editing a text item that bounds a pattern turns the boundary's selections of its paths into the whole shape, as it does for operation targets (ADR-0059), since path indices don't survive a new layout.
- **The cells are one shape:** a pattern drawing has exactly one shape, holding every cell's paths in stock coordinates, which the schema checks. Generating it again (from an edit of the settings or of the boundary) replaces that shape's paths in one undo step, keeping its id. An edit whose generation leaves no path inside the boundary is refused, with the reason, since a shape has at least one path.
- **Operations target the shape, which keeps its id:** as for a text item, an operation machining a pattern targets its one shape. Path indices don't survive a regeneration, so a regeneration turns the pattern's targets that list paths into whole-shape targets, and drops the profile tabs lying on its old paths. Picking a part of the pattern for an operation works until the next regeneration; machining part of a pattern for good means converting it to a drawing first (P9).
- **The placement anchors the pattern to its boundary:** `placement` is a text item's (`{ position, rotation, mirrored }`, ADR-0059): the pattern's origin, a cell corner, at `position` in stock coordinates, the cells mirrored left to right first if `mirrored`, then turned `rotation` degrees counter-clockwise about it. The settings panel shows `position` as an offset from the boundary's bounds. A move, turn or mirror of the boundary's drawing maps `placement` with the same transform (`position` moves, a turn adds to `rotation`, a mirror flips `mirrored` and the rotation's sense) and regenerates the pattern, so its cells move with the boundary. A scale of the boundary maps `position` only: the cells keep their size and more or fewer of them fill the new outline (P4). The boundary's drawing and its patterns change in the same undo step.
- **Transforming a pattern on its own** maps its placement the same way, and regenerates inside the same boundary: a move shifts the origin, a turn or mirror turns or mirrors the cells, and a scale multiplies `size`, `gap`, `amplitude` and `wavelength` (not `inset`, a distance from the boundary). Design alignment moves `position` with the shapes.
- **When the boundary goes away (P8):** deleting any of the boundary's shapes or its drawing removes `pattern` from every drawing it bounds, in the same undo step: each becomes a plain drawing with the cells it had, as *Convert to drawing* does. A path selection that names paths of a shape still present is never left dangling, since imported shapes aren't edited (ADR-0018). Hiding or locking the boundary changes nothing for the pattern, which stays shown and machined.
- **Converting to a drawing (P9)** removes `pattern`; the shape and the operations targeting it stay as they are.
- **Generation runs in a worker:** the generator is a `cam-core` module (`pattern/`, ADR-0037), worker-safe, called from a workspace worker (ADR-0004), so a slow pattern never freezes the workspace (P7). The server never generates a pattern; it validates the stored cells as any drawing's paths.
- **Schema version 42** adds `pattern`. Existing documents have no patterns and migrate unchanged.

## Consequences

- Toolpaths, posts, the viewport, picking, snapping, bounds, archives and `.furrow` files handle patterns without change; the server validates targets on a pattern as on any drawing.
- The document carries every pattern's cells: a pattern of 10 000 cells weighs about as much as an imported drawing of 10 000 paths.
- A pattern can't be machined in parts across edits; converting it to a drawing gives that up for the link to its boundary.
- A document edited by hand can store cells that don't match the settings or the boundary; the next regeneration replaces them.
- Every edit to a drawing that bounds a pattern regenerates the pattern, which the workspace has to wait for before it commits the undo step.
