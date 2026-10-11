# ADR-0016: XY zero on any stock anchor or a custom point

- **Status:** Proposed
- **Date:** 2026-10-11
- **Deciders:** Federico Vezzoli
- **Related:** PRD-0002 (Z1, Z3, Z4, Z6, Z8), ADR-0014, ADR-0003

## Context

ADR-0014 stores geometry in stock coordinates and turns them into work coordinates (what G-code is written in) with one translation, `stockOffset(stock)`. Its offset table covers the two XY origins the document allowed: the stock's bottom-left corner and its centre.

PRD-0002 asks for the XY zero on any of the 9 stock anchors (the 4 corners, the 4 edge midpoints and the centre, Z1) or on a custom point (Z4), such as a fixture corner, a fence or a hole centre. Anchors must follow the stock when it is resized (Z3); a custom zero must keep its stock position (Z6) and may lie outside the stock.

## Options considered

1. **Anchors as fractions of the stock and custom zeros in stock coordinates**: `{ anchor }` for the 9 anchors, `{ anchor: "custom", x, y }` in millimetres from the stock's bottom-left corner. Resizing the stock moves anchors with it and leaves custom zeros where they are, with no rewriting.
2. **Store every zero as a point**: anchors become a computed `x, y` when picked. Simpler offset, but resizing the stock would have to rewrite the zero to keep it on its anchor, and the picker could no longer tell which anchor is selected.
3. **Custom zero in work coordinates or relative to an anchor**: makes the stored point depend on another setting, so changing that setting would move the zero on the stock.

## Decision

The stock's `xyOrigin` is either `{ anchor }`, with `anchor` one of `bottom_left`, `bottom_center`, `bottom_right`, `middle_left`, `center`, `middle_right`, `top_left`, `top_center`, `top_right`, or `{ anchor: "custom", x, y }`, with finite `x` and `y` in millimetres in stock coordinates (ADR-0014). `zOrigin` is unchanged.

ADR-0014's decision stands: geometry is in stock coordinates and work coordinates differ by `stockOffset(stock)`. Its offset table extends to:

| XY origin | Offset added to stock coordinates |
| --- | --- |
| `bottom_left` | `(0, 0)` |
| `bottom_center` | `(-width / 2, 0)` |
| `bottom_right` | `(-width, 0)` |
| `middle_left` | `(0, -height / 2)` |
| `center` | `(-width / 2, -height / 2)` |
| `middle_right` | `(-width, -height / 2)` |
| `top_left` | `(0, -height)` |
| `top_center` | `(-width / 2, -height)` |
| `top_right` | `(-width, -height)` |
| `custom` | `(-x, -y)` |

The Z offsets are ADR-0014's. `xyOriginPosition` in `@furrow/cam-core` gives the zero in stock coordinates, for the viewport marker and the zero-point UI.

Documents saved with the old string values (`"bottom_left"`, `"center"`) still parse and are normalised to `{ anchor }`, so the schema version stays at 1.

## Consequences

- Choosing any anchor or custom zero is still a one-field change that never moves the design.
- Post-processor tests must cover every anchor and a custom zero, not just the two origins of ADR-0014 (#26).
- The viewport grid is aligned to the zero and extended to reach it when a custom zero lies outside the stock.
- A custom zero is a fixed point: it doesn't follow shapes it was picked from (PRD-0002 non-goals).
- The legacy string form is accepted on input only; documents are always written in the object form.
