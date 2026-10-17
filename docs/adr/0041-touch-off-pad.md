# ADR-0041: A touch-off pad of stock top that no operation cuts

- **Status:** Proposed; superseded in part by [ADR-0043](0043-touch-off-pad-opt-in.md) (no pad on import; centred on the zero; drawn as a dashed ring with a label; moves with the design; its own tool change)
- **Date:** 2026-10-17
- **Deciders:** Federico Vezzoli
- **Related:** PRD-0002, PRD-0005, ADR-0014, ADR-0016, ADR-0030, ADR-0033, ADR-0038, ADR-0039, ADR-0040; issue #147

## Context

GRBL has no tool length offsets, so every bit change pauses with `M0` and asks for Z to be zeroed again. With `zOrigin: "stock_top"` (ADR-0014) that only works if some of the original stock top survives the operations before the change. ADR-0038's roughing margin keeps a frame of stock top when the user picks it, but nothing guarantees one: a relief roughed with a 6 mm end mill over the whole stock and finished with a 3 mm ball end mill (PRD-0005's user flow) can leave no surface at the stock's original height.

## Decision

- **In the document:** `Stock.touchOff` is `{ x, y, diameter } | null`, the pad's centre in stock coordinates and its diameter, positive and no larger than the stock's smaller side (schema v13). Existing projects get `null`. It is only used with `zOrigin: "stock_top"` (`activeTouchOff` in `@furrow/cam-core`); with `machine_bed` it is kept but ignored and not drawn.
- **Default:** importing a drawing or a model into a project without a pad adds one (`defaultTouchOff`), 15 mm across (no wider than the stock's smaller side), at the stock corner nearest the XY zero, inset by its radius. A corner where the whole pad is clear of the design's bounding box comes first, then one whose corner point is clear, then the nearest; between corners as near as each other, bottom ones come first, then left ones. A model fitted with ADR-0038's 10 mm border leaves no corner clear for a 15 mm pad, so it takes the nearest corner whose point is clear, and the toolpaths keep it.
- **3D operations never cut it:** the pad is a flat-topped disc at the stock top that every tool is dropped onto, exactly and wherever it is, inside the model's heightmap or past it (`ToolDropper`'s discs). Finishing passes, spirals and waterline contours ride over it, and linear roughing passes too, past the grid as well. Offset and peel roughing add it as an island at every level, as a polygon around the circle. ADR-0040's rule keeps passes from nicking its edge as they drop off it. Rest machining needs nothing more: the earlier operations never cut the pad either.
- **2D operations warn:** a profile, pocket, drill, engrave or V-carve whose cut, below the stock top, comes within the tool's reach of the pad keeps its toolpath and warns ("cuts into the touch-off pad"). Clipping a 2D cut would change the part.
- **Toolpath inputs** carry the active pad, so changing it (its diameter keeps its centre) recomputes every toolpath.
- **GRBL post:** at a tool change, after `M5` and the retract, the tool rapids over the pad's centre before `M0 (Change the bit to … and zero Z on the touch-off pad)`. A machine's custom tool-change block is still written verbatim, after the retract and the move. The program's header says where the pad is, in work coordinates.
- **UI:** the zero section of the stock properties has a Touch-off pad checkbox, the pad's X and Y and its diameter, shown only with Z zeroed on the stock top, converting units only there, and a warning when part of the pad is off the stock. The viewport draws it on the stock top at its diameter, like the zero marker.

## Consequences

- A roughing-then-finishing job always has a spot to zero Z on after the tool change, as long as the pad stays on the stock.
- Finishing a model that the pad overlaps leaves the model unfinished under and around the pad; the user moves the pad where it overlaps nothing that matters.
- A 2D operation that runs over the pad cuts it, with a warning, rather than silently changing the part.
- The pad joins every toolpath's input, so moving it recomputes every operation, not only those near it.
