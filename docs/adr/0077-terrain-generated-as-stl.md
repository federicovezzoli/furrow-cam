# ADR-0077: Terrain is generated in the browser as an STL mesh and imported like one

- **Status:** Proposed
- **Date:** 2026-11-08
- **Deciders:** Federico Vezzoli
- **Related:** PRD-0014, PRD-0005 (S1, S2), ADR-0004, ADR-0029, ADR-0030, ADR-0047, ADR-0050, ADR-0072, ADR-0076

## Context

PRD-0014 turns an area picked on a map into a relief model. The elevation comes as Terrarium-encoded WebP tiles in Web Mercator (ADR-0076): each pixel's height is `R × 256 + G + B / 256 − 32768` metres. Everything that machines a relief reads an STL mesh: the mesh and toolpath workers, the model heightmap (ADR-0030), project archives and the stored asset, keyed by the SHA-256 of the STL bytes (ADR-0029, ADR-0047, ADR-0050). STEP import already produces an STL in a worker and hands it to the same import (ADR-0072). PRD-0005 S1 caps a mesh at 50,000,000 bytes and 2,000,000 triangles by default; a binary STL takes 50 bytes per triangle, so the byte limit binds first, at about 1,000,000 triangles.

## Options considered

1. **Generate an STL and import it** like any model. Pros: nothing downstream changes, no schema change, the project opens without a connection and in older versions of the app. Cons: the area and settings are lost after generating, so changing them means generating again.
2. **A terrain item in the document** (area, settings) whose heights are fetched when the project opens. Pros: tiny document, editable later. Cons: every open needs the network and the services to be up, the toolpaths change whenever the data is updated, and every reader of models gains a new kind.
3. **Store the heights as a new asset type** read straight into the heightmap. Pros: no triangles. Cons: a new asset kind, schema change and code path in storage, archives, the viewport and both workers, for a mesh the existing path handles.

## Decision

We will use option 1:

- **Where it runs:** the mesh worker (ADR-0004) fetches the tiles and decodes them with `createImageBitmap` and an `OffscreenCanvas`, then hands the pixels to pure functions in `@furrow/cam-core` (`import/terrain/`, no DOM): decode, resample, mask and mesh, written out with `writeBinaryStl`. The worker then hashes and checks the STL as any import and returns it to be stored, as for STEP (ADR-0072).
- **Ground grid:** a regular grid in metres on a local projection centred on the area (`x = R Δλ cos φ₀`, `y = R Δφ`), so the model has true proportions whatever its latitude; the horizontal error stays about 1% at the edge of a 200 km area. Each cell's height is sampled bilinearly from the tiles.
- **Detail:** the grid is the largest that keeps the whole mesh within the instance's STL limits (PRD-0005 S1); with the default limits that is about 700 × 700 cells. Tiles are fetched at the lowest zoom whose pixels are no larger than a cell; where a tile is missing at that zoom (no regional data), its parent tile is used instead.
- **Mesh:** two triangles per cell inside the shape (a cell is inside when its centre is, and cells touching the rest only at a corner are dropped, so every edge belongs to exactly two faces), vertical walls along the outline down to the base, and a flat bottom, so the mesh is closed. The bottom is triangulated from the outline's vertices only, so it costs about as many triangles as the outline has edges and the top keeps the triangle budget. `earcut` (ISC, a few kB) does it, behind an adapter in `cam-core/src/geometry/` beside the Clipper2 and Delaunator ones; Delaunator can't keep the outline's edges. Heights become `(h − h_min) × scale × exaggeration + base`, where `scale` maps the area's longest side to the model's longest side (PRD-0014 T4); everything below the lowest altitude, if set, is flat (T10). Cells outside the shape are left out: the relief heightmap puts them at the model's base (ADR-0030).
- **Into the project:** the STL is stored like an imported model named `<place>.stl`, and placed at the chosen size centred on the stock, not refitted. No outline drawing is added for now (PRD-0014 T7). *Download STL* (T8) saves the same bytes with `downloadFile` (`@furrow/ui/lib/download`), as G-code export does.
- **Nothing else is stored:** neither the area nor the settings nor the place searched are kept in the document.

## Consequences

- No schema change and no migration; a project with a terrain opens offline and in versions of the app older than this feature.
- Changing the area or the exaggeration means generating again; the old model stays until the user deletes it.
- Detail is capped by the STL limits, not by the data: about 0.3 mm per cell on a 200 mm model with the defaults, coarser than the 0.1 mm relief grid (ADR-0030) but finer than most data under it (30 m cells outside regions with lidar). Raising the operator's limits raises the detail.
- Flat areas cost as many triangles as steep ones; simplifying the mesh would allow finer detail within the same limits and stays open.
