# ADR-0018: Operations target paths, not whole shapes

- **Status:** Proposed
- **Date:** 2026-10-12
- **Deciders:** Federico Vezzoli
- **Related:** PRD-0001 (R1, R5, R7, R8), ADR-0003, ADR-0008, ADR-0010

## Context

An operation referred to the shapes it cuts by id (`shapeIds`), and the workspace selected whole shapes from the Geometry pane only. The SVG importer makes one shape per element, and files from CAD tools often hold a whole part in one element: an OpenSCAD export is a single `<path>` with the outline and every hole. With whole shapes, the outline can't be profiled without the holes, and one hole can't be drilled on its own (#54).

ADR-0008 also calls for selecting shapes in the 2D view, using our own geometry for picking rather than WebGL raycasting.

## Options considered

1. **Operations reference paths, shapes stay as imported**: each operation lists targets, `{ shapeId, paths }`, with `paths` the indices of the shape's paths it cuts or `null` for all of them. Imported files keep their grouping in the Geometry pane, and documents migrate mechanically (`shapeIds` become whole-shape targets).
2. **A "split into paths" action**: turns a shape into one shape per path, so `shapeIds` keeps working. The user must split before cutting part of a shape, splitting a file with hundreds of paths floods the Geometry pane, and the grouping the file had is lost.
3. **Path ids**: give every path a UUID and reference those. Stable even if shapes were edited, but every stored path grows an id, and shapes aren't edited after import.

## Decision

Operations reference paths (option 1). `targets: [{ shapeId, paths: number[] | null }]` replaces `shapeIds` in project document schema v2:

- One target per shape. `paths` lists indices into the shape's `paths`, ascending and each once, or is `null` for the whole shape. The document rejects unknown shapes and indices past a shape's paths.
- Path indices are stable because shapes aren't edited after import. An editing feature that reorders, adds or removes paths must rewrite the targets that point into the shape, or supersede this ADR.
- The migration from v1 turns each `shapeIds` entry into `{ shapeId, paths: null }`.
- Toolpath generation receives the targeted shapes with only their targeted paths (`targetedShapes` in `@furrow/cam-core`), so the generators are unchanged and the toolpath key changes exactly when the cut paths do.

The workspace selection (ADR-0010) is a set of paths, `{ shapeId, path }`. Selecting a shape in the Geometry pane selects all its paths; clicking a path in the top view selects that path. A selection becomes targets per shape, `null` once all of a shape's paths are selected, so a whole-shape selection is stored as before.

Viewport picking uses `pathAt` in `@furrow/cam-core` (ADR-0008): the path whose flattened line is nearest the cursor within a pixel radius, otherwise the innermost closed path containing the cursor, whatever its size, otherwise nothing.

## Consequences

- An outline and its holes in one imported element can be cut by separate operations, and single holes drilled.
- Imported files keep their grouping; the Geometry pane shows how many of a shape's paths are selected when not all are.
- Any future shape editing (exploding, joining, deleting paths) has to keep targets valid.
- A pocket clears what its targeted paths enclose: islands it should leave standing must be targeted too, as in other hobby CAM tools. **Select inside** in the Geometry pane adds every closed path inside the selected ones (`closedPathsInside`), rather than pockets leaving untargeted paths standing on their own.
- Clicking inside any closed path picks it, so clearing the selection in the viewport means clicking outside every closed path, or using Clear in the Geometry pane.
