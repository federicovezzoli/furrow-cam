# ADR-0014: Geometry is stored in stock coordinates

- **Status:** Accepted
- **Date:** 2026-10-09
- **Deciders:** Federico Vezzoli
- **Related:** PRD-0001 (R1, R2, R3), ADR-0003, ADR-0008

## Context

The project document (ADR-0003) stores imported geometry as points in millimetres and the stock with a size, a thickness and an origin: XY at the bottom-left corner or the centre of the stock, Z at the stock top or the machine bed (R3). The origin is where the machine is zeroed and what G-code coordinates are measured from.

The schema didn't say which frame shape coordinates are in. Import (R1, R2), the viewport (ADR-0008), toolpath generation and the post-processors all need the same answer, and changing it later would mean migrating every stored document.

## Options considered

1. **Work coordinates**: points are measured from the chosen origin. G-code can use them as they are. But changing the origin moves the design across the stock (switching to a centred origin shifts it by half the stock), so changing the origin would also have to rewrite every shape to keep the design in place, and undo it.
2. **Stock coordinates**: points are measured from the stock's bottom-left corner, with `z = 0` at the stock top. The origin is a separate setting that only affects where the machine is zeroed. Toolpath and G-code code must convert, but that is one translation.

## Decision

Geometry is stored in **stock coordinates**: `(0, 0)` is the stock's bottom-left corner and `z = 0` its top face, with Z pointing up out of the material.

**Work coordinates** (the frame G-code is written in) differ only by a translation, given by `stockOffset(stock)` in `@furrow/cam-core`:

| Origin | Offset added to stock coordinates |
| --- | --- |
| XY `bottom_left` | `(0, 0)` |
| XY `center` | `(-width / 2, -height / 2)` |
| Z `stock_top` | `0` |
| Z `machine_bed` | `+thickness` |

- Importers place shapes in stock coordinates.
- Toolpaths are generated in stock coordinates; the post-processor adds the offset when writing G-code.
- The viewport draws its scene in stock coordinates and shows the work origin as a marker, so changing the origin moves only the marker and the grid aligned to it.

## Consequences

- Changing the stock origin is a one-field change: the design stays where it is on the stock, and nothing needs rewriting or a migration.
- Every consumer that outputs machine coordinates must apply `stockOffset`; forgetting it would offset the cut by up to half the stock, so post-processor tests must cover both origins.
- Resizing the stock keeps the design anchored to the bottom-left corner.
