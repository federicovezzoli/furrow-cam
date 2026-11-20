# ADR-0088: A pattern is placed through its boundary and its own settings, not transformed on its own

- **Status:** Accepted
- **Date:** 2026-11-20
- **Deciders:** Federico Vezzoli
- **Related:** ADR-0087 (supersedes its "Transforming a pattern on its own"), PRD-0016 (P4, P5)

## Context

ADR-0087 let a pattern be moved, turned, mirrored and resized on its own, as any drawing: each mapped its placement and regenerated it inside the same boundary. In use this was confusing. The drawing's own size, orientation and position controls sat beside the pattern's settings. *Center on stock* or a drag moved the pattern's origin, so the cells shifted inside a boundary that stayed where it was, and nothing on screen said why. Two sets of controls did the same thing (the pattern's rotation and offset, and the drawing's turn and position), and it was unclear which belonged to the pattern and which to the drawing.

## Decision

- **A pattern's panel shows only its settings:** the cell type, size, gap, inset, wave shape, seed, rotation, *Mirrored* and the offset from the boundary's corner, plus *Duplicate*, *Remove* and *Convert to drawing*. The drawing's size, orientation and position sections (with *Fit to stock* and *Center on stock*) are hidden for a pattern. A note says that the pattern follows the drawing it fills.
- **The viewport doesn't drag a pattern on its own.** Its boundary's drawing is dragged instead.
- **`placement.mirrored` is a setting**, toggled in the panel, since the drawing's mirror buttons are no longer offered for a pattern.
- What ADR-0087 says about transforming the **boundary** stands: the pattern moves, turns and mirrors with it, and its cells keep their size when it is resized.
- The store actions that transform a drawing (`moveDrawing`, `rotateDrawing`, `mirrorDrawing`, `setDrawingSize`) still handle a pattern as ADR-0087 describes. Design alignment and the MCP server use them.

## Consequences

- Each control on a pattern's panel changes the pattern itself, and the boundary is the one way to place it.
- Scaling a pattern's cells is done through *Cell size* (and *Gap*, *Wave height*, *Wavelength*), not by resizing the pattern.
