# PRD-0002: Zero point selection

- **Status:** Draft
- **Author:** Federico Vezzoli
- **Created:** 2026-10-11
- **Related:** PRD-0001 (R3), ADR-0014, ADR-0016, ADR-0022; issues #49, #50, #51, #26, #91

## Problem

The zero point (work origin) is where the user zeroes the machine before cutting, and what every G-code coordinate is measured from. Today the project document can only put the XY zero at the stock's bottom-left corner or its centre (PRD-0001 **R3**), and the workspace has no control to change it: every project is zeroed at the bottom-left corner of the stock top.

Real jobs often need something else:

- The stock is pushed against a fence or stop in a corner other than bottom-left, so that corner is the easiest to find with the bit.
- The job is aligned to an edge (e.g. centred along the front edge for a sign).
- The zero must be on a feature, not on the stock: the centre of an existing hole, a dowel pin, or a corner of a previously cut part when re-machining.

Without these options, users have to re-draw their design around a fixed origin or edit the G-code by hand, which is exactly what Furrow CAM promises to avoid.

## Users

Same as PRD-0001: hobbyists and small shops with GRBL-class routers, who zero their machine by jogging the bit to a point on the stock or a fixture.

## Goals

- The user can put the XY zero wherever they will physically zero the machine, in a couple of clicks.
- The anchor says how the drawing sits on the stock: on import, when an anchor is chosen and when the stock is resized, the drawing's bounding box is aligned to the stock at that anchor, so the zero is the same point of both (ADR-0022).
- A custom zero is picked on what is already on the stock: the drawing stays where it is, and only the G-code coordinates change.
- The chosen zero is always visible in the viewport, so it's obvious where to zero the machine.

## Non-goals

- **New Z options:** Z keeps today's two options, the stock top or the machine bed (only a control to choose between them is added, Z10).
- **Machine-side zeroing help:** setup sheets, touch-plate probing (`G38.2`) or homing routines.
- **Travel checks** against the machine's work area.
- **Machine-level defaults:** the zero is a per-project setting; new projects keep today's default (bottom-left, stock top).
- **Zero attached to a shape:** a picked point is stored as a fixed position; moving the shape later does not move the zero.
- **Multiple work offsets** (`G54`–`G59`) or several zeros per project.

## Requirements

| ID | Requirement | Priority |
| --- | --- | --- |
| Z1 | XY zero can be any of 9 stock anchors: the 4 corners, the 4 edge midpoints and the centre | Must |
| Z2 | A 3×3 picker in the stock properties selects the anchor, laid out like the stock as seen from above in the viewport | Must |
| Z3 | Anchors follow the stock: resizing the stock keeps the zero on the same anchor, and the drawing stays aligned to it (ADR-0022) | Must |
| Z4 | Custom XY zero: the user types X and Y, measured from the stock's bottom-left corner, in project units (unit-aware input). It may lie outside the stock (e.g. on a fixture corner or a fence) | Must |
| Z5 | Custom XY zero by picking a point in the viewport, with snapping to stock anchors, shape vertices, arc and circle centres, and shape bounding-box corners and centres | Should |
| Z6 | A custom zero stays at its stock position when the stock is resized or the design changes | Must |
| Z7 | The viewport shows the zero with an axis marker (X/Y arrows), and the grid aligns to it | Must |
| Z8 | Toolpath and G-code coordinates are measured from the chosen zero for every anchor and for custom zeros; post-processor tests cover all of them | Must |
| Z9 | Changing the zero is a single undoable action | Must |
| Z10 | The stock properties let the user choose the Z zero: stock top or machine bed | Must |
| Z11 | With Z zeroed on the stock top, the user can turn on a touch-off pad (a disc of stock top, 15 mm across by default, off until ticked, centred on the XY zero) that 3D operations keep uncut and 2D operations warn about. At each tool change the post writes the pad's tool-change block, derived from the machine's with the tool kept over the pad, or the project's own; the zero section shows the block that runs. Its position and diameter are edited in the zero section, it moves with the design when the stock is resized or the zero changes anchor, and the viewport marks it with a dashed ring and a label (ADR-0041, ADR-0043, ADR-0056) | Should |

## User flow

1. Open the stock properties.
2. Click one of the 9 cells in the zero picker. The drawing is aligned to the stock at that anchor, and the marker in the viewport jumps there.
3. Or choose **Custom**: type X/Y, or click **Pick in viewport**, hover until the cursor snaps to the hole centre, and click.
4. Export G-code. On the machine, jog the bit to the same point and zero X/Y there.

## Success criteria

- A part zeroed on each of the 9 anchors and on a picked hole centre cuts in the right place on a GRBL machine with no manual G-code edits.
- Wherever a drawing sits in its file, it lands on the stock aligned at the chosen anchor, and choosing another anchor re-aligns it.

## Open questions

- None at the moment.

## Changelog

- 2026-10-11: initial draft
- 2026-10-11: custom zero may lie outside the stock (Z4)
- 2026-10-14: the drawing is aligned to the stock at the zero's anchor on import, when an anchor is chosen and when the stock is resized, replacing "changing the zero never moves the design" (goals, Z3, user flow, success criteria; #91, ADR-0022)
- 2026-10-17: touch-off pad for zeroing Z after a tool change (Z11; #147, ADR-0041)
- 2026-10-17: the touch-off pad is off until ticked, centred on the zero, drawn as a marker, moves with the design and can have its own tool change (Z11; #177, #178, ADR-0043)
- 2026-10-22: the pad's tool change is always a block, derived from the machine's unless the project has its own, and the zero section shows it (Z11; #284, ADR-0056)
