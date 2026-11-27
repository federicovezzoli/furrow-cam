# ADR-0095: Models import at their size, even past the stock

- **Status:** Accepted
- **Date:** 2026-11-27
- **Deciders:** Federico Vezzoli
- **Related:** PRD-0005 (S2), ADR-0022, ADR-0031, ADR-0034, ADR-0038, ADR-0055, ADR-0077; issue #673. Supersedes ADR-0031's *Import* and the import half of ADR-0038's *Fitted models leave a border*.

## Context

An imported STL or STEP model was scaled to fit inside the stock less its border (ADR-0031, ADR-0038). A part drawn at a known size in a solid modeller then arrived at the wrong size, and the user had to read its original size in the panel and type the scale back in. Drawings already keep the size in their file (ADR-0055), and a terrain or image relief is made at a chosen size (ADR-0077).

## Options considered

1. **Keep fitting on import.** Pros: the model is always on the stock. Cons: a part's real size is lost, silently, on every import.
2. **Import at the file's size, aligned like a drawing.** Pros: a part comes in at the size it was drawn; *Fit to stock* is one click away. Cons: a model larger than the stock goes past its edges until the user resizes one or the other; an STL exported in inches comes in 25.4 times too small, where the fit used to hide it.
3. **Ask on import.** Pros: either outcome. Cons: a dialog on every import for a choice one button already makes.

## Decision

Option 2. A new model is unrotated, at scale 1 (an STL's coordinates are millimetres), its depth the mesh's height even when that is deeper than the stock, its top at the stock top, and aligned at the zero's anchor (bottom-left for a custom zero) to the stock less the model's border, as a drawing is aligned (`addModel`). It keeps the 10 mm border, which the next *Fit to stock* applies. Terrain and image reliefs are still centred on the stock (ADR-0077). MCP `import_file` does the same.

## Consequences

- A model can arrive past the stock's edges; *Fit to stock* and the size fields are next to it in its panel. The viewport's cameras fit the shown models as well as the stock and the zero, and fit again when a model is added or removed (not when one is moved).
- `initialPlacement` in `@furrow/cam-core` is no longer used on import; the post end-to-end projects still use it to place a fitted model.
