# ADR-0030: Relief toolpaths from a model heightmap

- **Status:** Proposed; superseded in part by [ADR-0032](0032-relief-finishing-passes.md) (the finishing grid is laid out along the passes)
- **Date:** 2026-10-15
- **Deciders:** Federico Vezzoli
- **Related:** PRD-0005, ADR-0004, ADR-0007, ADR-0019

## Context

PRD-0005 machines STL reliefs from the top on 3-axis routers: no undercuts, the tool never tilts. Finishing passes (S4) need, at every point along a pass, the lowest height the tool tip can reach without cutting into the model; roughing (S5) needs the model's outline at each Z level, enlarged by the stock to leave; rest machining (S8) needs the stock left by the earlier operations. Toolpaths run in a Web Worker (ADR-0004). The material-removal simulation already keeps the stock as a heightmap and describes every tool by its profile (ADR-0019).

Meshes go up to 2,000,000 triangles (PRD-0005 S1).

## Options considered

1. **Exact drop-cutter against the triangles** (as in OpenCAMLib): for each point, test the tool against every triangle in reach (faces, edges, vertices) through a spatial index. Pros: exact at any resolution. Cons: one intersection routine per tool shape and triangle feature, sensitive to bad meshes, and a different representation from the simulation, so rest machining needs a conversion anyway.
2. **Model heightmap and inverse tool offset**: rasterise the mesh into a grid of heights (the highest surface above each cell), then drop the tool's profile onto the grid. Pros: simple, robust to non-manifold or overlapping triangles, the same grid and tool profiles as the simulation, and z-level slices come from thresholding it. Cons: accuracy is limited by the cell size, and memory grows with the area.

## Decision

We will use option 2, in `@furrow/cam-core`:

- **Rasterising:** each triangle is scan-converted into a `Float32Array` grid in stock coordinates, every cell keeping the highest point of any triangle above it (a z-buffer from above). Cells the model doesn't cover are at the model's base. This fills undercuts by construction (PRD-0005 S3).
- **Resolution:** the cell is the smaller of **0.1 mm** and **a twentieth of the tool radius**, within a cap of **4096 × 4096 cells (16,777,216)**, 64 MB of heights. Above the cap, cells grow until it fits, and the UI says the model is cut at a coarser resolution. Unlike the simulation's cap (ADR-0019), this one never depends on the device, so a project gives the same G-code everywhere. A 300 × 200 mm relief with a 3 mm ball end mill (0.075 mm cells) takes 4000 × 2667 cells and fits.
- **Stock to leave:** before any toolpath, the model heightmap is offset by the stock to leave in every direction: each cell takes the highest `model(q) + √(s² − |q − p|²)` over the cells within `s` of it (a dilation by a sphere of radius `s`). Steep and vertical walls move out by `s` as well as up, so roughing leaves material on them for finishing. Finishing and roughing both work on this offset heightmap.
- **Finishing:** passes are sampled every cell along each raster line. At each sample, the tool tip height is the highest `offset(q) − profile(|q − p|)` over the cells `q` within the tool radius, with the tool profiles of ADR-0019. Consecutive samples on a straight line are merged within a tolerance, so the G-code stays compact.
- **Roughing:** at each Z level, the cells where the offset heightmap rises above that level are traced into islands, and the model's area minus those islands is cleared with the existing pocket clearing (Clipper2, ADR-0007), which keeps the tool a radius away from them.
- **Rest machining (S8):** the stock left by the earlier operations is simulated with ADR-0019 on the same grid, and an operation only cuts where that stock is above its own cut.
- **Performance target:** finishing a 300 × 200 mm relief with a 3 mm ball end mill at a 10% stepover in **under 10 s** in the worker on a recent laptop, with progress reported and cancelling supported. The rasterised model is cached per mesh, placement and resolution.

## Consequences

- One representation for models, simulation and rest machining.
- Details smaller than a cell are lost, and steep walls are only as sharp as the cell size; 0.1 mm is below what wood holds.
- A large relief cut with a small tool hits the grid cap and loses resolution; tiling the grid would lift this later.
- Dropping the tool is the hot loop. If the target isn't met, a tool-sized maximum filter computed once per tool (instead of per sample) or a WebAssembly kernel are the next steps, without changing this decision.
