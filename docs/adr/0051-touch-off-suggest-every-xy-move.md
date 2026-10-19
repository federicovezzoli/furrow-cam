# ADR-0051: Touch-off Suggest keeps the tool on the pad through every kind of XY move

- **Status:** Proposed
- **Date:** 2026-10-19
- **Deciders:** Federico Vezzoli
- **Related:** PRD-0005 (S12), ADR-0043; #250. Supersedes the part of ADR-0043's *Its own tool change* bullet that says which moves **Suggest** puts on the pad.

## Context

**Suggest** (`suggestTouchOffToolChange`, ADR-0043) starts the pad's tool change from the machine's block and keeps the tool over the pad until the block zeroes Z, at its first pause or probe. It recognised an XY move only by an explicit `G0`/`G1` word with an X or Y in work coordinates. Other moves that leave the pad before the zeroing stayed in the block, after the move to the pad:

- modal moves, such as `X10 Y10` after an earlier `G0`;
- moves in machine coordinates, such as `G53 G0 X-10 Y-10` to a fixed tool-change position;
- moves to a stored position, `G28` and `G30`.

Z was then zeroed off the pad, on the bed, a clamp or the relief, and every move after the tool change ran at the wrong height. A block whose only XY move was a `G53` one got a move to the pad before it, so the `G53` move took the tool straight off again.

## Options considered

1. **Warn in the zero section** when the suggested block still moves XY before the zeroing. Pros: the block stays as the machine wrote it. Cons: the user must fix the G-code by hand, and the default result is still unsafe.
2. **Treat every XY move before the zeroing as one**, in the way ADR-0043 already treats explicit absolute moves. Pros: Suggest's result is safe without editing. Cons: the tool change happens over the pad instead of at the machine's fixed tool-change position.

## Decision

We will use option 2. Before the zeroing, an XY move is any line that, under the modal motion and distance mode so far, moves X or Y. The block starts in a straight-move mode: the program enters it with `G0` or `G1` active, so `X0 Y0` or `G53 X-10 Y-10` before any motion word moves too.

- a straight move or an arc, with an explicit or modal `G0` to `G3`, in work or machine coordinates (`G53`);
- a `G28` or `G30` with an X or Y word, or with no axis words, which moves every axis.

Lines whose axis words set something rather than move (`G10`, `G92`, `G28.1`, `G30.1`) are not moves.

- The **first** XY move goes to the pad. An absolute straight move in work coordinates keeps its line with X and Y set to the pad, as before. Any other first move keeps its other axes (a `G53 G0 Z-5` part, say), then is followed by an absolute move to the pad, with `G91` restored after it where the block moves relatively. A `G28` or `G30` with no axis words becomes a rise to the safe Z and the move to the pad.
- The **other** XY moves before the zeroing lose their X and Y, so the tool stays over the pad. An arc can't lose its end point, so its other axes (a helix's Z) move as a straight `G1` instead. A `G28` or `G30` left with no axis words loses its move, and a bare one becomes a rise to the safe Z.
- **Nothing else on a line goes with its move.** Its other words (`G90`, `G91`, `F`, `S`, `M`) and its comment stay, on a line of their own where the move is gone, since the lines after the zeroing rely on them: a dropped `G91` would make them absolute, a dropped feed would leave GRBL without one, a dropped `M5` would leave the spindle running into the bit change.
- **The block's motion mode is restored before the zeroing.** The pad move is a `G0`, and a dropped or rewritten line may not set the mode the machine's block did. Where the suggested lines leave another mode than the block's own, a `G0` or `G1` on its own line sets it again, so a modal move after the pause still feeds or rapids as the block meant. An arc mode can't be set without an arc, so it isn't restored: a block that relies on a modal arc after the pause is left as is.
- Lines at or after the zeroing, and blocks with no XY move before it, are handled as in ADR-0043.

## Consequences

- A machine whose tool change goes to a fixed position in machine coordinates, or home, now changes the bit over the pad in the suggested block. The user can still edit it.
- The suggested block may differ more from the machine's: lines can be split (a `G53` move's Z kept, its XY replaced), reduced to their other words, or gain a line restoring the motion mode.
- Blocks the user already saved are not changed; Suggest has to be clicked again.
