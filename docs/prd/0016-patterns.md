# PRD-0016: Patterns

- **Status:** Draft
- **Author:** Federico Vezzoli
- **Created:** 2026-11-19
- **Related:** PRD-0009, PRD-0010, PRD-0012, ADR-0055, ADR-0059, ADR-0080

## Problem

Decorative fills (honeycomb, waves, fish scales, crosshatch, Voronoi cells) are a common way to finish a sign, a box lid, a coaster or a panel. Today the pattern has to be drawn in a vector editor, clipped to the shape by hand and imported. When the shape moves or changes size, the whole round trip starts again. Pattern tools for makers exist, but they export a rectangular tile and leave the fitting to the user.

## Users

- Hobbyists who want to texture an area of a piece they have already drawn: the inside of a frame, a letter, a lid.
- Makers who iterate on the size and the density of a fill until it looks right, and want the toolpaths to follow.

## Goals

- A user selects a closed shape already in the project, picks a pattern and gets it clipped inside the shape, ready for the existing operations, without a vector editor.
- The pattern stays editable and follows its shape: moving, resizing or turning the shape regenerates the pattern inside it, and the operations that machine it keep their targets.

## Non-goals

- 3D textures: patterns in depth, heightmaps, relief fills (a later PRD, through the relief chain of PRD-0005).
- A pattern editor for drawing new cells by hand. A cell taken from an imported shape is a *Could* (P9).
- Wrapping a pattern on a curved model, or deforming it to follow a shape's outline (warp, flow along a path).
- New operations: patterns are machined by profile, pocket, engrave and V-carve as they are.

## Requirements

| ID | Requirement | Priority |
| --- | --- | --- |
| P1 | **Fill with pattern:** with one drawing's closed paths selected (or a whole drawing whose paths are closed), a command adds a pattern inside them. Nested closed paths count even-odd, so a frame's inside or a letter's counter stays empty. Open paths in the selection are ignored; with no closed path selected the command is off, with the reason in its tooltip | Must |
| P2 | **A pattern is a drawing** (ADR-0055) with its settings, like a text item (ADR-0059): its paths are derived from the settings and its boundary, it is listed in the Objects pane (ADR-0080) and selected, hidden and locked like any drawing | Must |
| P3 | **Cells are cut at the boundary:** cells that cross it are clipped to it; closed cells become closed paths along the boundary, line patterns become open paths ending on it. An optional inset keeps the pattern a distance inside the boundary | Must |
| P4 | **Follows its boundary:** moving, resizing, turning or mirroring the boundary's drawing regenerates the pattern inside it, its cells keeping their size (the pattern is anchored to the boundary, not stretched). Editing a pattern's settings or its boundary keeps the operations that machine it, in one undo step | Must |
| P5 | **Settings:** the cell type; the cell size; the gap between cells (the wall a pocket leaves standing, or zero for shared edges); the rotation; an offset of the pattern's origin; and the settings a cell type has of its own (amplitude and wavelength of a wave, the seed of a random pattern, a line's spacing). Sizes in the current units. The viewport previews the change while a field is edited | Must |
| P6 | **Cell library**, as many as the generator draws well. *Must:* square grid, brick, hexagons (honeycomb), triangles, diamonds, circles on a square and on a hexagonal grid, parallel lines, crosshatch, waves, zigzag. *Should:* herringbone, basket weave, fish scales, chevrons, stars, Truchet arcs (seeded), Voronoi cells (seeded). Each cell type has a thumbnail in the picker | Must / Should |
| P7 | **Machining:** profile, pocket, engrave and V-carve take a pattern like any drawing. A pattern of many cells stays responsive: generating and drawing 10 000 cells does not freeze the workspace (the generation runs in a worker, ADR-0004) | Must |
| P8 | **When the boundary goes away:** deleting the boundary's paths turns the pattern into a plain drawing with the paths it had, as *Convert to drawing* does, in the same undo step. Hiding the boundary leaves the pattern shown and machined | Must |
| P9 | **Convert to drawing:** a pattern becomes a plain drawing, which can be transformed and edited like any other but no longer follows its boundary, as a text item does (PRD-0010 T8) | Should |
| P10 | **From an assistant:** the MCP server (PRD-0012) fills a shape of a project with a pattern, with the P5 settings and the same defaults | Should |
| P11 | **Custom cell:** a closed shape already in the project is used as the cell, tiled on a square or a hexagonal grid | Could |

## User flow

1. The user imports a drawing (a sign with a frame) or types a text item.
2. They select the frame's inner outline and choose **Fill with pattern**.
3. A pattern of hexagons fills the outline; its properties panel opens over the viewport with the cell picker and the settings.
4. They change the cell to *Waves*, the size and the gap, and watch the preview.
5. They add a V-carve (or an engrave, or a pocket) on the pattern, as on any drawing.
6. They resize the sign: the pattern regenerates inside the new outline and the V-carve follows.
7. They simulate and export G-code as usual.

## Decision record

ADR-0087 decides how a pattern is stored (its settings and a reference to its boundary's paths in `Drawing.pattern`, its derived paths as its one shape, as a text item, ADR-0059), how operations keep targeting it when it regenerates, what anchors the pattern to its boundary, and where the generation runs (a cam-core module, `pattern/`, called from a worker).

## Success criteria

- A user carves a honeycomb inside the frame of an imported sign, then resizes the sign and re-exports, with no other tool.
- A 300 × 200 mm panel filled with 5 mm hexagons generates, previews and simulates without freezing the workspace.

## Open questions

- ~~A pattern drawn across several drawings' paths: allowed, or one drawing only as P1 says?~~ One drawing only (ADR-0087).
- ~~Should the pattern's cells be merged into one shape, or each cell its own shape?~~ One shape, which operations keep targeting across regenerations (ADR-0087).

## Changelog

- 2026-11-19: created
- 2026-11-19: open questions answered by ADR-0087
