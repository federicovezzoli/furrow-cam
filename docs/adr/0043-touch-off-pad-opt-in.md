# ADR-0043: The touch-off pad is opt-in, sits on the zero, follows the design and can have its own tool change

- **Status:** Proposed; superseded in part by [ADR-0053](0053-touch-off-suggest-every-xy-move.md) (which moves Suggest puts on the pad) and [ADR-0056](0056-touch-off-tool-change-shows-what-runs.md) (a `null` tool change runs the derived block; Reset replaces Suggest and Use the machine's)
- **Date:** 2026-10-17
- **Deciders:** Federico Vezzoli
- **Related:** PRD-0002 (Z11), PRD-0005 (S12), ADR-0014, ADR-0016, ADR-0022, ADR-0041; issues #177, #178. Supersedes ADR-0041's *Default*, the viewport part of its *UI* bullet, and its *GRBL post* bullet where the pad has its own tool change.

## Context

ADR-0041 adds a touch-off pad to every project on its first import, in a stock corner the design leaves free, and the viewport draws it as a faint filled disc in the tabs' green. Users who don't know the feature take it for the tool seen from above or for a stray object, and only jobs with a tool change need it.

The pad is stored in stock coordinates and nothing moves it when the stock is resized or the zero changes anchor, while the drawing and models follow an anchored zero (ADR-0022): the pad ends up off the stock or in the middle of it.

At a tool change the GRBL post rapids over the pad, then writes the machine's custom `toolChange` block if it has one. Such blocks often move on their own, to a probing spot or a fixed tool-change position (V1 Engineering's LowRider preset moves to `X10 Y10` and probes there), so the move over the pad is wasted and Z is zeroed where the block says, not on the pad.

## Decision

- **Off by default:** importing a drawing or a model adds no pad. A project has one when the user ticks **Touch-off pad** in the zero section. Projects that already have a pad keep it.
- **On the zero:** the new pad is centred on the XY zero (`defaultTouchOff`), 15 mm across, no wider than the stock's smaller side, so the tool change goes back to `X0 Y0`. With the zero on a stock edge or corner, part of the pad is off the stock and the zero section warns; the user moves it or leaves it.
- **Follows the design:** resizing the stock or putting the zero on an anchor moves the pad by the same offset as the drawing and the models. After the change, a pad that was wholly on the stock is moved the least it takes to be wholly on it again (`clampTouchOff`); one partly off is left there. Under a custom zero the design stays put, so the pad is only kept on the stock.
- **Its own tool change:** `TouchOff.toolChange` (schema v14, existing pads get `null`) is G-code that replaces, for this project, the whole tool change: the machine's `toolChange` block and the move over the pad. `{padX}` and `{padY}` in it stand for the pad's centre in work coordinates and `{safeZ}` for the machine's safe Z, filled in by the post, so the block follows the pad and the machine. `null` keeps ADR-0041's behaviour: the move over the pad, then the machine's block or the default pause. The zero section edits it in a text area under the pad's fields, saved when the field loses focus, with **Suggest**, which starts from the machine's block and keeps the tool over the pad until the block zeroes Z, at its first pause or probe (`suggestTouchOffToolChange`): its first absolute `G0`/`G1` move to an X or Y in work coordinates goes to the pad, the other XY moves before the zeroing lose their X and Y, and a relative first move becomes an absolute one to the pad with `G91` restored after it. Every other line and word stays as it was. A block with no such move gets a rise to `{safeZ}` and a move over the pad before it, and a machine without a block gets the default tool change with the move.
- **Toolpaths ignore the tool change:** toolpath inputs carry only the pad's disc (`TouchOffDisc`), so editing the text recomputes nothing.
- **Drawn as a marker:** the viewport draws the pad as a dashed ring at its diameter, with dashes a constant size on screen, a cross at its centre and a "Z touch-off" label a fixed size on screen, in a colour of its own (`touchOff`, distinct from tabs and the snap marker, in both themes). No filled disc.

## Consequences

- A relief job with a tool change needs one more step, ticking the pad; a user who forgets it has nothing guaranteed to touch off on.
- A pad on a corner zero is three quarters off the stock until the user moves it; in exchange, Z is zeroed where X and Y are.
- A machine whose tool change probes or moves can have it run on the pad without editing the machine profile, and only in the projects that use a pad. The project's block is copied unchecked like the machine's, apart from the placeholders.
- The pad no longer reads as part of the design or as the tool, and keeps its place relative to the zero when the stock changes.
