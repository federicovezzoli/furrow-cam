# ADR-0019: Material-removal simulation with a heightmap

- **Status:** Proposed
- **Date:** 2026-10-12
- **Deciders:** Federico Vezzoli
- **Related:** PRD-0001 (R10), ADR-0003, ADR-0004, ADR-0008

## Context

PRD-0001 R10 asks for a basic 3D material-removal simulation: the stock as it will look after cutting. ADR-0008 says it uses the viewport's scene and that its algorithm gets its own ADR. The toolpaths are computed in a Web Worker (ADR-0004) and only their line segments reach the main thread. Every operation in this release is 2.5D (profile, pocket, drill): tools move along Z, never tilt.

It must stay responsive on a full sheet (2440 × 1220 mm) cut with a 3 mm tool.

## Options considered

1. **Heightmap**: a grid over the stock in which each cell holds the height of the stock top. Every move sweeps the tool's shape across the grid and lowers the cells it covers. Simple, fast and exact enough for 2.5D cuts; it can't represent anything not visible from above.
2. **Voxels**: a 3D grid of filled and empty cells. Shows undercuts, but memory grows with the thickness too (a full sheet at 1 mm would be tens of millions of voxels per millimetre of depth), and turning voxels into a mesh is costly.
3. **Constructive solid geometry (mesh booleans)**: subtract each move's swept volume from the stock mesh. Exact, but far too slow for hundreds of thousands of moves, and fragile.

## Decision

Simulate with a **heightmap** (`simulateCuts` in `@furrow/cam-core`, a `Float32Array` of heights in stock coordinates: `0` uncut, `-thickness` cut through).

- **Resolution:** square-ish cells, **6 across the smallest tool diameter** in use, so a slot as narrow as the tool shows its floor and walls. The grid is capped at **2048 × 4096 cells (8,388,608)**, 32 MB of heights: if the stock would take more, cells grow until it fits. The heights are drawn from one float texture 2048 texels wide, the most every WebGL 2 device supports; the cap drops to 2048 × the device's largest texture size when that is under 4096 (2048 × 2048 at worst). A full sheet with a 3 mm tool gets cells of about 0.6 mm instead of 0.5 mm. The grid always has at least 2 cells each way, and covers the stock exactly.
- **Tool shapes:** each tool is the height of its cutting edge above the tip at each distance from its axis, out to its radius:
  - flat end mill: level (0) across the diameter;
  - drill: level, like a flat end mill, because the document doesn't record a drill's point angle;
  - ball end mill: a hemisphere, `r − √(r² − d²)`;
  - V-bit: level across its tip, then rising at its included angle, `(d − tip radius) / tan(angle / 2)`.
- **Sweep:** at each cell `q`, a straight move from `a` to `b` reaches down to `min z(t) + profile(|q − p(t)|)` over the points `p(t)` of the move within the tool's radius of `q`. `z` is linear in `t`, and every profile rises and is convex with distance, so this is a convex function of `t`: on a level move its minimum is at the closest point; for a level-bottomed tool it is at the lower end of the range in reach; otherwise a golden-section search finds it. That is exact for ramps and helices (as chords), with no subdividing of moves. Each cell keeps the lowest height reached, so cuts can be applied in any order, and heights are clamped to the stock top and bottom.
- **What cuts:** every move of every enabled operation whose toolpath was computed, rapids included (a rapid through the stock would cut it). Hidden toolpaths still cut; operations whose toolpath failed don't.
- **Where it runs:** in its own Web Worker (ADR-0004), from the toolpath line segments the main thread already holds, recomputed whenever the toolpaths or the stock change and only while the simulation is shown. It is derived data and never stored (ADR-0003).
- **Rendering:** the heights go to the GPU as one float texture. The surface is one instanced quad per pair of neighbouring cell centres, which the vertex shader lifts to the heights (the outer cells reach the stock's edges), shaded by a fixed light and darker with depth so floors read in the top view; walls down to the stock bottom close the sides. No per-vertex buffers, so even the largest grid costs only its texture. It replaces the stock box; the toolpaths stay drawn over it, pushed back by a polygon offset so feeds along a cut's floor show.

## Consequences

- One 2D array per simulation: fast enough (a full sheet with a 3 mm tool and thousands of moves simulates in one to a few seconds in the worker, ball end mills the slowest) and simple to test.
- It can't show anything not visible from above: undercuts, overhangs, the inside of a cut that a later cut passes over at a higher level (only the lowest point counts), or material left behind a tool's shank. None of this release's operations makes those, but tilted tools or T-slot cutters would need another approach.
- Features smaller than a cell are blurred: walls between cell centres are drawn sloped over one cell, and at the cap a full sheet shows a 3 mm slot about 5 cells wide.
- Drills show a flat-bottomed hole instead of their point; a drill point angle in the tool would fix that.
- Playing back the cut move by move would build on the same sweep, applied to a prefix of the moves.
