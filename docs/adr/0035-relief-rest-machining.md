# ADR-0035: Rest machining simulates the earlier toolpaths on a coarser grid

- **Status:** Proposed
- **Date:** 2026-10-16
- **Deciders:** Federico Vezzoli
- **Related:** PRD-0005 (S8, S11), ADR-0004, ADR-0019, ADR-0030, ADR-0032, ADR-0033; issue #118

## Context

PRD-0005 S8 lets a 3D operation start from the stock the operations before it left, so a smaller tool only cuts where material remains. ADR-0030 says that stock is simulated with ADR-0019 on the operation's own grid, and the operation only cuts where it is above its own cut. It leaves open where the earlier toolpaths come from, which operations count, and how to keep it fast.

The worker computes one operation at a time from its `ToolpathInput` (ADR-0004), and G-code export computes every toolpath from the document. A finishing toolpath over a 300 × 200 mm relief has over 600,000 short moves. Swept with a ball end mill on 0.075 mm cells (ADR-0030), it took 206 s.

## Decision

- **Option:** relief finishing and roughing params have `rest` (document schema v10; existing operations get `false`). A rest operation's input holds the inputs of the enabled operations before it, in order, so its key changes whenever one of them does. Every other operation's input holds none, and changing them recomputes nothing else.
- **Earlier toolpaths:** the worker and G-code export keep the last toolpaths computed as simulation cuts (`[x, y, z]` move pairs, 24 bytes a move), by toolpath key, 8 in the worker. The key holds the earlier operations' own keys without their `before`, which is part of its own, so chained rest operations don't grow it exponentially. A rest operation takes the operations before it from there, or computes them. An operation before it whose toolpath fails cuts nothing, with a warning. The worker accepts the mesh of any model those operations machine.
- **Rest grid:** the stock is simulated over the operation's grid, in its frame, with cells no smaller than **0.25 mm** (half of the minimum width below). For roughing, it also covers everything the tool reaches from its roughing area (ADR-0038), which may extend past the model's grid: past the simulation, the tool would meet stock it can't see and cut it in one go (#246). Its cells grow if it would take more than the model grid's cell limit. Cells outside the stock have no material. Sloped moves of non-flat tools find their lowest point to an eighth of a cell rather than exactly. Stopping early only leaves more stock, so the operation cuts more, never less.
- **What counts as left:** stock more than **0.05 mm** above the operation's own cut (`REST_MATERIAL`, above the 0.01 mm merging tolerance of ADR-0032) and wider than **0.5 mm** (`REST_MIN_WIDTH`). Roughing leaves slivers a cell or two wide on walls (ADR-0033), which aren't worth chasing along every wall.
- **Passes (finishing and linear roughing):** at each sample, the tool cut short by 0.25 mm is dropped onto the rest grid at the sample's own position. The pass cuts where that is higher than its own height plus 0.05 mm, from one sample before to one after. Runs closer than a tool diameter are joined. Across the gaps the tool rapids at the entry clearance above the highest stock left within its full radius and a rest cell's diagonal along the way (the shortened profile only decides where to cut, never how low a rapid goes). It enters each run from that clearance, plunging at the plunge rate (roughing ramps from what is left, as ADR-0033 does). Zig-zag passes are linked only when within two tool diameters, otherwise the tool retracts.
- **Pocket levels (offset and peel roughing):** at each level, what is left above it is traced on the rest grid and kept where the tool can reach (the level's area opened by the tool radius), opened by 0.25 mm, grown by the tool's diameter and 0.25 mm, and the level's area is cleared only within that.
- **Simulation sweep:** a sloped move of a non-flat tool skips a cell whenever the move's lowest point in reach, with the tool's edge at its least distance, is no lower than the cell. This is exact, and speeds up the viewport's simulation too (ADR-0019).

## Consequences

- On an Apple M1 Pro in Node, with the benchmark relief of ADR-0032 (480,000 triangles, 300 × 200 mm): finishing with a 3 mm ball end mill after roughing with a 6 mm flat end mill takes about 4.2 s with rest machining (3.1 s without). After a full finish with the same tool, it takes 7.4 s and finds nothing to cut.
- A big tool, then a smaller one, cuts only what the big one couldn't reach, e.g. a pocket's corners.
- Material narrower than 0.5 mm, or less than 0.05 mm thick, stays for finishing. Material between rest cells is only seen as far as the cell size allows.
- Changing any enabled operation before a rest operation recomputes it, even one far from its model.
- With more than 8 operations before a rest operation, the worker computes some of them again each time.
- 2D pockets (S11) could reuse the rest grid and the pocket-level clipping later.
- ADR-0030 is superseded in part: the rest stock is simulated on a coarser grid than the operation's.
