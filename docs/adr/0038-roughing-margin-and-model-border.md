# ADR-0038: Roughing can clear a margin around the model, and fitted models leave a border

- **Status:** Proposed
- **Date:** 2026-10-17
- **Deciders:** Federico Vezzoli
- **Related:** PRD-0005 (S2, S5), ADR-0014, ADR-0022, ADR-0031, ADR-0033, ADR-0034; issue #146. Supersedes ADR-0033's *Boundary* and ADR-0031's *Import* and *Editing* (*Fit to stock*) in part.

## Context

ADR-0033 lets 3D roughing clear the model's outline or the whole stock. ADR-0031 scales a new model to fit the stock edge to edge, and *Fit to stock* does the same, so the model's outline is the whole stock and both boundaries remove all of the stock top. GRBL has no tool length offsets, so a tool change asks for Z to be zeroed again on the stock top (`zOrigin: "stock_top"`, ADR-0014): a roughing-then-finishing job has nothing left to touch off on. Users also want a clean frame cleared around a relief without facing the whole stock.

## Decision

- **Boundary as an object:** `ReliefRoughParams.boundary` is `{ type: "model" } | { type: "margin", distance } | { type: "stock" }`, with `distance` in millimetres and positive. Schema v11 turns the stored `"model"` and `"stock"` into `{ type }`. New operations still clear the model's outline; picking the margin starts it at 5 mm.
- **What a margin clears:** the model's outline grown by the distance, clipped to the stock (`roughingArea` in `@furrow/cam-core`). Unlike the other two boundaries, the tool's whole disc stays inside it, so the stock top beyond it is left at `z = 0`: the tool's centre covers the rectangle shrunk by the tool radius. The rectangle grows by the tool radius at least, so the tool's centre always reaches the model's edges as with the model boundary (ADR-0033), and finishing never meets uncut material there. Where the grown rectangle reaches the stock's edge, the centre goes to the edge and the tool overhangs it, as with the whole stock. Toolpath inputs carry the stock for the margin as for the whole stock, so resizing the stock recomputes them.
- **Clearing inside the margin** is ADR-0033's, unchanged: every strategy, rest machining (ADR-0035) and the linear passes work within the area as before. Like the model boundary, a wall at the model's own edge is only cleared beside where the tool fits inside the margin.
- **Fitted models leave a border:** import and *Fit to stock* fit the model inside the stock less a border (`modelBorder`): the model's own `border` (schema v15), 10 mm a side for a new model and editable next to *Fit to stock* down to 0 (edge to edge), never more than a quarter of the stock's smaller side. Editing it doesn't move the model; the next fit applies it. The model is aligned to that inset rectangle at the zero's anchor (`stockFit`), or at its bottom-left corner with a custom zero, as ADR-0031 aligns it to the stock. Turning, scaling and moving a model, choosing an anchor and resizing the stock are unchanged: they keep or align the design as before (ADR-0022, ADR-0031), and only the two fitting actions apply the border.

## Consequences

- A relief fitted to the stock and roughed with a margin smaller than the border keeps a frame of uncut stock top for zeroing Z after a tool change. The Z touch-off pad (#147) builds on it.
- Choosing an anchor still aligns the design's bounding box to the stock's edges, so it moves a fitted model onto the edge, past the border. Fitting again brings the border back.
- A new model is up to 20 mm smaller than before on a stock that limits it, which users who wanted it edge to edge undo by setting its size.
