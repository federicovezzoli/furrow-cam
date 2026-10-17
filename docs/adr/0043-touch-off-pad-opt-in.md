# ADR-0043: The touch-off pad is opt-in, drawn as a marker, and moves with the design

- **Status:** Proposed
- **Date:** 2026-10-17
- **Deciders:** Federico Vezzoli
- **Related:** PRD-0002 (Z11), PRD-0005 (S12), ADR-0016, ADR-0022, ADR-0041; issues #177, #178. Supersedes ADR-0041's *Default* and the viewport part of its *UI* bullet.

## Context

ADR-0041 adds a touch-off pad to every project on its first import, and the viewport draws it as a faint filled disc in the tabs' green. Users who don't know the feature take it for the tool seen from above or for a stray object, and only jobs with a tool change need it. The pad is stored in stock coordinates and nothing moves it when the stock is resized or the zero changes anchor, while the drawing and models follow an anchored zero (ADR-0022): the pad ends up off the stock or in the middle of it.

## Decision

- **Off by default:** importing a drawing or a model adds no pad. A project has one when the user ticks **Touch-off pad** in the zero section, which places the default pad as ADR-0041 describes (`defaultTouchOff`: 15 mm across, in the stock corner nearest the XY zero that the design leaves free). Projects that already have a pad keep it; no migration.
- **Drawn as a marker:** the viewport draws the pad as a dashed ring at its diameter, with dashes a constant size on screen, a cross at its centre and a "Z touch-off" label a fixed size on screen, in a colour of its own (`touchOff`, distinct from tabs and the snap marker, in both themes). No filled disc.
- **Moves with the design:** resizing the stock or putting the zero on an anchor moves the pad by the same offset as the drawing and the models, since it was placed relative to the zero they follow. After the change, a pad that was wholly on the stock is moved the least it takes to be wholly on it again (`clampTouchOff`); one the user put partly off is left there. Under a custom zero the design stays put, so the pad is only kept on the stock.

## Consequences

- A relief job with a tool change needs one more step, ticking the pad, and a user who forgets it has nothing guaranteed to touch off on; the zero section's checkbox sits next to the Z zero it serves.
- The pad no longer reads as part of the design or as the tool.
- A pad stays in its corner when the stock is resized, so a pad that was placed by default keeps doing its job without being moved by hand.
