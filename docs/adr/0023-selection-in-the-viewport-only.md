# ADR-0023: Paths are selected in the viewport only

- **Status:** Proposed
- **Date:** 2026-10-14
- **Deciders:** Federico Vezzoli
- **Related:** PRD-0001 (R5, R7, R8), ADR-0018 (supersedes its Geometry pane parts), ADR-0008, ADR-0010; PR #103

## Context

ADR-0018 has two ways to select what an operation cuts: the Geometry pane, a list of the imported shapes where a click selects all of a shape's paths, and the top view, where a click selects one path. The Geometry pane also held the SVG/DXF import, **Select inside** and **Clear**.

In practice paths are picked in the top view; the list is barely used, and it took a third of the left column away from the operations. It was also the only way to select without a mouse: its rows were focusable buttons with `aria-pressed`, while the viewport is a canvas picked with the pointer (`pathAt`).

## Options considered

1. **Keep the Geometry pane**: keyboard and screen-reader selection, shape names, layers and partial-selection counts. Costs the space, for a list few use.
2. **Remove it and add *Select all***: a keyboard user can always build an operation, but only on the whole drawing.
3. **Remove it and fold a collapsed shape list into the Operations pane**: keeps keyboard selection, at the cost of the space and code the removal is meant to save.
4. **Remove it; selection is mouse-only for the MVP**: the simplest workspace; keyboard-only users can't select paths, so can't add operations.

## Decision

We will remove the Geometry pane and select paths in the viewport only, with the pointer (option 4), for the MVP:

- Importing moves to a card in the empty viewport, with the SVG DPI and DXF units questions; import warnings show in the viewport's corner until dismissed.
- The Operations pane shows what is selected, with **Select inside** (ADR-0018's island rule, unchanged) and **Clear**.
- Selection stays a set of paths (ADR-0018). Nothing selects or hovers a whole shape any more: the whole-shape hover (`path: null`) is gone, and a shape whose paths are all clicked becomes a whole-shape target as before.

## Consequences

- The left column holds Operations and Properties; the viewport gets the rest of the width.
- Selecting paths needs a pointer: the workspace isn't usable for creating operations by keyboard alone. A keyboard alternative (*Select all*, a shape list, or keyboard picking in the viewport) is a follow-up to decide before the workspace can claim to be accessible.
- Shape names, layers and partial-selection counts are no longer shown anywhere; a file with many separate outlines is selected one click (or Shift+click) per path.
- ADR-0018 stays in force for targets, picking and *Select inside*; its mentions of the Geometry pane no longer describe the workspace.
