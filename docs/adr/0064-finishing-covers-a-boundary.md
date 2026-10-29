# ADR-0064: 3D finishing covers the same boundary as roughing

- **Status:** Proposed
- **Date:** 2026-10-29
- **Deciders:** Federico Vezzoli
- **Related:** PRD-0005 (S4, S10), ADR-0030, ADR-0033, ADR-0038, ADR-0039, ADR-0063; issue #396. Supersedes ADR-0038's *What a margin clears* in part: finishing no longer stops at the model's edges.

## Context

ADR-0038 lets roughing clear a margin around the model, leaving the stock to leave on the margin's floor, and only promises that finishing reaches the model's edges. Finishing covers the model's outline, so after roughing with a margin the band from the model's edge plus the finishing tool's radius out to the margin's edge keeps the roughing allowance: the frame the margin was meant to clear isn't finished.

## Decision

- **Boundary:** `ReliefFinishParams.boundary` is a `RoughingBoundary` (`model`, `margin` with a distance, or `stock`). Schema v27 gives existing operations `{ type: "model" }`, so their toolpaths don't change; new ones cover the model's outline too.
- **What it covers:** the tool's centre covers roughing's `roughingArea` for the same boundary and finishing tool. For a margin, the tool stays inside the model's outline grown by the distance, except where that reaches the stock's edge, and the stock top beyond is left at `z = 0`. For the whole stock, the tool overhangs the stock's edges. Within the model's outline, the cut is the same as with the model boundary.
- **How:** the model's heightmap stays on the model's outline, grown by roughing's margin (the stock to leave, the tool's radius and a cell) when the boundary isn't the model, so a tool centred past it reaches no part of the model. Parallel passes and the spiral run over the cells whose centres are in the area, past the heightmap too, where the tool drops to the model's bottom plus the stock to leave (the parting plane on a two-sided project's side, ADR-0063) and onto the touch-off pad and holding tabs, as roughing's floor does. A large stock doesn't coarsen the model. For rest machining, the stock left is simulated over the area.
- **Waterline** follows walls, so it keeps to the model's outline whatever the boundary (`finishingBoundary`): its contours wouldn't sweep the flat floor around the model, and the larger grid would only cost time. The properties say so; parallel or spiral passes finish that floor.
- **Inputs:** a parallel or spiral finishing operation with a margin or the whole stock carries the stock in its toolpath inputs, as roughing does, so resizing the stock recomputes it. The margin-off-stock warning and the two-sided whole-stock warning now apply to both operations, with wording that doesn't say "rough".

## Consequences

- Roughing and finishing with the same margin leave a finished frame around the relief and the stock top beyond it for touching off.
- Passes past the model only meet the floor and the discs, so finishing the whole stock costs time in proportion to its area but no memory beyond the model's heightmap.
- Heightmaps are cached by their cells' size too, so two grids with the same corner and cell count never share one.
