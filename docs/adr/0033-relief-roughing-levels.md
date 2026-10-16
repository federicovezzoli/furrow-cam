# ADR-0033: Relief roughing clears simplified level outlines with the pocket strategies

- **Status:** Proposed
- **Date:** 2026-10-16
- **Deciders:** Federico Vezzoli
- **Related:** PRD-0005 (S5, S6), PRD-0001 (R20), ADR-0007, ADR-0030, ADR-0032; issue #116

## Context

ADR-0030 roughs a model by tracing, at each Z level, the cells of the offset heightmap above the level into islands, and clearing the model's area minus the islands with the existing pocket clearing. It leaves open what "the model's area" is, how the levels are chosen, and how cell outlines become polygons. Outlines along cell edges are staircases: a 300 × 200 mm relief at 0.1 mm cells gives islands with thousands of corners per level, and the pocket strategies offset them dozens of times, each corner growing an arc. A first version took over a minute per level.

## Decision

- **Grid:** the model is rasterised along the stock's axes (ADR-0032 lays finishing grids along the passes, so roughing doesn't share them), with ADR-0030's cell size and cap, grown by the stock to leave plus a cell on every side so walls at the model's edge move out by the stock to leave too. Cells no triangle covers are at the model's bottom.
- **Levels:** from the stock top down to the model's bottom plus the stock to leave, in equal steps no deeper than the tool's step-down, like pocket depth passes. A cell is above a level when it is more than 0.0001 mm above it, so the floor isn't an island because of `float32` rounding.
- **Islands:** traced along cell edges, so every cell above the level is inside them whole; cells touching only at a corner are traced apart. Each outline is simplified with Douglas-Peucker within one cell and grown by two cells (mitred). Every point of the staircase is within one cell of the simplified outline, so the grown outline still holds every cell above the level, whatever the simplification does to it. Roughing leaves up to about two cells more than the stock to leave on walls (0.2 mm at 0.1 mm cells).
- **Boundary:** the operation clears either the model's outline (its bounding rectangle seen from above) or the whole stock. In both cases the tool's centre reaches the edges, as the finishing passes' does (ADR-0032), so finishing never meets uncut material at the model's edge. With the whole stock, the tool overhangs the stock's edges by its radius, and everything around the model is cleared down to its bottom.
- **Clearing:** each level is the boundary grown by the tool radius less the islands, cleared as a pocket with no allowance and the operation's strategy, direction and ramping, at the tool's step-down. The step-over is the tool's unless the operation sets its own: roughing often wants a different one from the bit's 2D work, and changing the bit would change every operation that uses it. Lower levels only clear less, so the tool crosses what the level above cleared at that level's height, as a pocket's depth passes do. Levels are cut from the top down, each completely before the next. Peeling can't start from an island, since the islands change from level to level. Linear clearing leaves out the pocket's laps around the walls and islands: the islands grow at every level, so the laps stacked into rings, and the passes reach from edge to edge instead, the tool ramping along a pass to enter it. The passes leave small scallops against the model, which finishing removes.
- **Preview while recomputing:** an operation keeps showing its last toolpath, dimmed, only while numbers change (scrubbing a value). Picking another strategy, direction, boundary or other choice drops it, so nothing is drawn until the new one is ready: roughing takes seconds, and the old pattern looked like the change hadn't applied.
- **Stock in the toolpath input:** only roughing with the whole-stock boundary depends on the stock's size; the other operations get `null`, so resizing the stock recomputes nothing else.

## Consequences

- On an Apple M1 Pro in Node, roughing a 300 × 200 mm relief (480,000 triangles) with a 6 mm flat end mill at a 3 mm step-down takes about 1.7 s with offset clearing, 1.3 s with linear clearing and 5.8 s with peeling.
- Any tool shape is safe: the islands keep the tool's whole disc away from material above the level.
- Flat areas between two levels keep up to a step-down of material above the stock to leave, as in most Z-level roughing. Extra levels at flat areas, or rest machining (S8), could remove it later.
