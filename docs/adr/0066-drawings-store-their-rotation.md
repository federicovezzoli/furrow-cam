# ADR-0066: Drawings store their rotation

- **Status:** Proposed
- **Date:** 2026-10-29
- **Deciders:** Federico Vezzoli
- **Related:** ADR-0055, ADR-0059; PRD-0009 D6, D7; #387

## Context

PRD-0009 D7 turns a drawing by 90° steps and by any angle. Every turn rewrites the drawing's shapes (ADR-0055), and the document kept no angle for the drawing. The panel's *Angle* field was only how far *Rotate* would turn it, starting at 15°, so it showed 15° on a drawing never turned, 0 did nothing, and the 90° buttons left it alone. Users read it as the drawing's angle.

## Options considered

1. **Keep the field as a step**, with a clearer label: no schema change, but there is still no angle to show or go back to.
2. **Store the rotation on `Drawing`** and keep rewriting the shapes: the field shows and sets it.
3. **Store the shapes as imported plus a transform**: the cleanest model, but every consumer of `geometry` (toolpaths, selection, tabs, operations) would apply the transform, and scaling and moving would move into it too.

## Decision

We will store each drawing's rotation (option 2): `Drawing.rotation`, in degrees counter-clockwise, from above -180 up to 180, 0 for a new or imported drawing. Shapes stay in stock coordinates, rewritten by every transform as before.

- Every turn adds to it, the 90° buttons and the field alike; mirroring negates it, since a turn then a mirror is the mirror then the opposite turn.
- The field shows it. Committing a value turns the drawing by the difference, as one undo step; there is no separate *Rotate* button.
- Schema version 28 gives existing drawings 0: they count from where they are.

## Consequences

- 0 brings a drawing back to the orientation it was imported or typed in, unless it was mirrored an odd number of times, which a rotation cannot undo.
- Undo restores the rotation with the shapes, and it survives saving and project archives like any document field.
- A text item keeps its own placement rotation (ADR-0059), from which its outlines are laid out; the drawing's rotation is only what the panel shows. Both change together, in the same undo step.
