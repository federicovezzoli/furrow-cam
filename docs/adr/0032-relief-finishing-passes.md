# ADR-0032: Relief finishing passes in their own frame, cancelled between slices

- **Status:** Proposed
- **Date:** 2026-10-16
- **Deciders:** Federico Vezzoli
- **Related:** PRD-0005 (S4, S6), ADR-0004, ADR-0019, ADR-0030; issue #115

## Context

ADR-0030 drops the tool's profile onto a model heightmap rasterised in stock coordinates, sampling every cell along each pass, and sets a target of under 10 s for a 300 × 200 mm relief finished with a 3 mm ball end mill at a 10% step-over. That relief takes 4000 × 2667 cells of 0.075 mm, and the tool covers about 1,250 cells, so testing every cell under the tool at every sample means billions of operations. Passes at any angle (S4) would also sample between cell centres, where the heights aren't known.

The toolpath worker (ADR-0004) took one request at a time and answered when done. A finishing toolpath takes seconds, so it has to report its progress and stop early when the operation changes or the user cancels it.

## Options considered

1. **Grid in stock coordinates, passes sampled at any angle**: what ADR-0030 says. Pros: one heightmap for every angle, shared with roughing. Cons: samples fall between cells, and a sharp V-bit tip between cell centres hangs above the surface by up to `profile(half a cell)`. Nothing about a pass lines up with the grid, so every sample tests every cell under the tool.
2. **Grid in the passes' frame**: rasterise the mesh turned by `-angle`, so every pass runs along a row of cells. Pros: samples sit on cell centres. Along a row, each row of cells under the tool meets its disc in a chord of the same width at every sample, so a sliding maximum along the row gives each chord's highest cell in constant time. Cons: changing the angle rasterises the mesh again, and roughing will need its own grid along the stock's axes.
3. **Stopping by terminating the worker**: Pros: no change to the computation. Cons: every operation's request at the worker dies with it, and the next request starts a cold worker that has lost its meshes and heightmaps.
4. **Stopping between slices**: the toolpath is a generator that yields its progress, and the worker runs it in slices, letting messages in between. Pros: a cancel reaches one request, and the worker keeps its caches. Cons: the computation has to be written in steps.

## Decision

We will use options 2 and 4, in `@furrow/cam-core` and the toolpath worker.

- **Grid:** the model's outline is turned by `-angle`, and the grid covers its bounding box there, with ADR-0030's cell size and cap. Cells outside the outline stay at the model's bottom. Angles in quarter turns turn exactly.
- **Passes:** from the first row to the last, evenly spread no further apart than the step-over, each snapped to the nearest row centre. The tool's centre covers the outline from edge to edge (the column centres inside it), and never goes outside it.
- **Dropping the tool:** for each row of cells in reach of a pass, the chord's highest cell comes from a sliding maximum along the row. Minus the profile at the chord's middle, that bounds what the row can give. For a flat end mill or drill it is the exact answer. For the others, a chord is only scanned cell by cell when its bound beats the best row so far, nearest rows first. Zig-zag links and other points off the rows are dropped cell by cell.
- **Merging:** samples along a pass (and along a link) become straight moves that never go below a sample and pass at most **0.01 mm** above any, so merging never gouges.
- **Entry and feeds:** each pass, or each zig-zag run of passes, starts with a rapid down to the entry clearance above the stock top and a plunge at the tool's plunge rate. That is safe whether or not the model was roughed out. The passes and links cut at the tool's feed rate. One-way passes retract to the retract height between passes.
- **Progress and cancelling:** `toolpathSteps` yields the fraction done (rasterising and offsetting take the first 40%, the passes the rest). The worker runs it in slices of about 50 ms, posts progress at most every 100 ms, and between slices lets messages in through a `MessageChannel`, which avoids the delay of nested timers. A changed, disabled or deleted operation, or the user's Cancel, sends `{ cancel }` for its request. A cancelled request answers `cancelled`, and the operation stays cancelled until it changes or is computed again.
- **Meshes and caches:** the worker asks for a mesh it doesn't hold, and the scheduler sends the request again with the STL file from the browser's cache or the server (ADR-0029). It keeps the last 2 meshes and the last 2 heightmaps, keyed by mesh, placement, grid (angle included) and offset. Changing the step-over or the direction doesn't rasterise again. G-code export loads the meshes of the enabled 3D operations and sends them with the document.
- **Removing a model** removes the operations that machine it, in the same undo step, so the document never refers to a missing model.

## Consequences

- On an Apple M1 Pro in Node, the benchmark relief (480,000 triangles, 300 × 200 mm, 3 mm ball end mill, 10% step-over) finishes in about 3.4 s at 0°, 2.8 s at 45° and 5.5 s with 0.5 mm of stock to leave.
- A V-bit's tip sits on the surface at every sample, without the half-cell error.
- Turning the passes rasterises the mesh again. Roughing (S5) will rasterise along the stock's axes, so it doesn't share a heightmap with finishing at other angles.
- Every move along a pass is at the feed rate, even where it descends steeply. A plunge-rate limit on descending moves could come later.
- ADR-0030 is superseded in part: the grid is in the passes' frame rather than the stock's.
