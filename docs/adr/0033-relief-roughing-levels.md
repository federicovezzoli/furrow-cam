# ADR-0033: Relief roughing clears simplified level outlines with the pocket strategies

- **Status:** Proposed; superseded in part by [ADR-0038](0038-roughing-margin-and-model-border.md) (a margin boundary) and [ADR-0058](0058-step-over-per-operation.md) (the step-over)
- **Date:** 2026-10-16
- **Deciders:** Federico Vezzoli
- **Related:** PRD-0005 (S5, S6), PRD-0001 (R20), ADR-0007, ADR-0030, ADR-0032; issue #116

## Context

ADR-0030 roughs a model by tracing, at each Z level, the cells of the offset heightmap above the level into islands, and clearing the model's area minus the islands with the existing pocket clearing. It leaves open what "the model's area" is, how the levels are chosen, and how cell outlines become polygons. Outlines along cell edges are staircases: a 300 × 200 mm relief at 0.1 mm cells gives islands with thousands of corners per level, and the pocket strategies offset them dozens of times, each corner growing an arc. A first version took over a minute per level.

## Decision

- **Grid:** the model is rasterised along the stock's axes, or along the passes for the linear strategy (as ADR-0032 lays finishing grids), with ADR-0030's cell size and cap, grown by the stock to leave, the tool radius and a cell on every side, so walls at the model's edge move out by the stock to leave too and a tool centred past the grid reaches only the model's bottom. Cells no triangle covers are at the model's bottom.
- **Levels:** from the stock top down to the model's bottom plus the stock to leave, in equal steps no deeper than the tool's step-down, like pocket depth passes. A cell is above a level when it is more than 0.0001 mm above it, so the floor isn't an island because of `float32` rounding.
- **Islands:** traced along cell edges, so every cell above the level is inside them whole; cells touching only at a corner are traced apart. Each outline is simplified with Douglas-Peucker within one cell and grown by two cells (mitred). Every point of the staircase is within one cell of the simplified outline, so the grown outline still holds every cell above the level, whatever the simplification does to it. Roughing leaves up to about two cells more than the stock to leave on walls (0.2 mm at 0.1 mm cells).
- **Boundary:** the operation clears either the model's outline (its bounding rectangle seen from above) or the whole stock. In both cases the tool's centre reaches the edges, as the finishing passes' does (ADR-0032), so finishing never meets uncut material at the model's edge. With the whole stock, the tool overhangs the stock's edges by its radius, and everything around the model is cleared down to its bottom.
- **Clearing:** each level is the boundary grown by the tool radius less the islands, cleared as a pocket with no allowance and the operation's strategy, direction and ramping, at the tool's step-down. The step-over is the tool's unless the operation sets its own: roughing often wants a different one from the bit's 2D work, and changing the bit would change every operation that uses it. Lower levels only clear less, so the tool crosses what the level above cleared at that level's height, as a pocket's depth passes do. Levels are cut from the top down, each completely before the next. Peeling can't start from an island, since the islands change from level to level.
- **Preview while recomputing:** an operation keeps showing its last toolpath, dimmed, only while numbers change (scrubbing a value). Picking another strategy, direction, boundary or other choice drops it, so nothing is drawn until the new one is ready: roughing takes seconds, and the old pattern looked like the change hadn't applied.
- **Linear strategy:** the pocket's linear clearing stops its passes at each island and follows the island's edge to the next pass, and its laps around every island stack into rings over the levels. Roughing doesn't use it. At each level, straight passes along the strategy's angle, one step-over apart, cross the whole boundary, the tool cutting at the level or riding on the offset model where the tool dropped onto it is higher, as finishing drops it (ADR-0032, with the grid along the passes). Each pass is trimmed to where the level above left material. Passes zig-zag, linked by straight moves that ride on the model, or retract when the next pass is more than two tool diameters away; entries ramp along the start of the pass where it is flat at the level. The tool is dropped with its profile widened by one sample's spacing, so the moves between samples never cut into the offset model. Direction doesn't apply.
- **Stock in the toolpath input:** only roughing with the whole-stock boundary depends on the stock's size; the other operations get `null`, so resizing the stock recomputes nothing else.

## Consequences

- On an Apple M1 Pro in Node, roughing a 300 × 200 mm relief (480,000 triangles) with a 6 mm flat end mill at a 3 mm step-down takes about 1.7 s with offset clearing, 1.3 s with linear clearing and 5.8 s with peeling.
- Any tool shape is safe: the islands keep the tool's whole disc away from material above the level.
- Flat areas between two levels keep up to a step-down of material above the stock to leave, as in most Z-level roughing. Extra levels at flat areas, or rest machining (S8), could remove it later.
