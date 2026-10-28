# PRD-0011: Two-sided machining

- **Status:** Draft
- **Author:** Federico Vezzoli
- **Created:** 2026-10-23
- **Related:** PRD-0001, PRD-0002, PRD-0005, ADR-0016, ADR-0030, ADR-0031, ADR-0035, ADR-0041, ADR-0060, ADR-0063

## Problem

Furrow CAM machines from the top only (PRD-0005 S3, which lists flipping the stock as a non-goal). Many models are meant to be seen from both sides, such as figurines, chess pieces, ornaments, handles and double-sided plaques. On a 3-axis router these are cut in two setups: the top, then the stock is flipped on locating pins and the bottom is cut. Users need another CAM for this, and getting the two sides to line up by hand is error-prone.

## Users

- Hobbyists carving 3D objects from STL files that have no flat back.
- Small shops making pieces finished on both faces (a pocket or an engraving on the back of a panel).

## Goals

- A user can go from an STL model to G-code for both sides, with the two halves meeting within the machine's repeatability once the stock is flipped on its pins.
- The part stays held to the stock until both sides are cut.

## Non-goals

- 4th axis or indexed rotary machining.
- More than two setups, or flipping by anything other than half a turn about X or Y.
- Sides other than top and bottom (machining the stock's edges).
- Probing the stock to find where it lies after the flip.

## Requirements

| ID | Requirement | Priority |
| --- | --- | --- |
| B1 | A project can be two-sided: the user picks the flip axis (X or Y). Each operation belongs to the top or the bottom side | Must |
| B2 | A model in a two-sided project is machined from both faces. Each side cuts all of the model it can see from its face, and around the model down to a parting height the user sets (half the model's depth by default), so models not widest at that height are cut without a skirt. The model's depth may now reach the full stock thickness | Must |
| B3 | Relief roughing and finishing (PRD-0005 S4, S5, S10) work on the bottom side, on the model as seen from below | Must |
| B4 | Locating pin holes: the user sets their diameter and positions on the flip axis, and chooses whether they go through the stock into the spoilboard (pins fixed in the spoilboard) or only into the stock to a depth they set. A drill operation on the top side cuts them, and the bottom side's zero is placed so the flipped stock lines up on them | Must |
| B5 | Holding tabs keep the part attached to the surrounding stock at the parting height, so it does not come loose while the bottom side is cut. They belong to the two-sided setup and every 3D operation leaves them. The user sets their width and thickness, places a number of them evenly around the model's outline and drags them along it, as for profile tabs | Must |
| B6 | The viewport and the simulation show each side; the bottom side's simulation starts from the stock the top side left, flipped | Must |
| B7 | G-code is exported as one file per side, named after the side, with the setup to do between them (flip, pins, zero) in the file's header comment | Must |
| B8 | 2D operations (profile, pocket, drill, engrave, V-carve) on the bottom side, on drawings mirrored about the flip axis | Should |
| B9 | Line up the flipped stock against its edges instead of pins, for users without a spoilboard to drill into | Could |

## User flow

1. The user imports `owl.stl` into a 30 mm thick stock, ticks **Two-sided** and keeps the flip axis on X and the parting height at half the model's depth.
2. They place two 6 mm locating pins on the flip axis, outside the model, and four holding tabs.
3. On the top side they add a drill for the pins, 3D roughing and 3D finishing. On the bottom side they add 3D roughing and 3D finishing.
4. They check both sides in the simulation and export two G-code files.
5. At the machine they cut the top side and pin holes through into the spoilboard, flip the stock about X onto the pins, zero as the bottom file says, and cut the bottom side.

## Success criteria

- A user cuts a two-sided relief from a downloaded STL on a GRBL machine, with the two halves meeting without a visible step beyond the machine's repeatability, and no manual G-code edits.
- The part is still held to the stock at the end of the bottom side's roughing.

## Changelog

- 2026-10-23: initial draft
- 2026-10-23: B4 the user chooses through or blind pin holes
- 2026-10-28: B2 each side cuts all of the model it can see, the parting height bounds only the cut around it; B5 tabs belong to the setup (ADR-0063); open questions closed
