# ADR-0059: A text item is a drawing that keeps its settings and stores its outlines as one shape

- **Status:** Proposed
- **Date:** 2026-10-24
- **Deciders:** Federico Vezzoli
- **Related:** PRD-0010 (T1, T3, T8), ADR-0003, ADR-0004, ADR-0014, ADR-0022, ADR-0055; #347–#353

## Context

PRD-0010 adds text items: a line of text in a font, at a cap height and an alignment, that stays editable (T3). Changing a word must keep the item's place on the stock and the operations that machine it. ADR-0055 makes every drawing a group of shapes whose points are rewritten by each transform, so toolpaths, posts, the viewport, picking, snapping, tabs, bounds and design alignment read stock coordinates and nothing else. Operations target shapes by id, and optionally some of their paths by index (ADR-0018).

A text item's outlines come from a font (#348). Fonts are files the browser loads (#349) or project assets (#352). The server validates documents but never computes geometry (ADR-0004), and toolpaths run in workers.

## Options considered

1. **Settings only, outlines derived when read.** A text item stores its text, font and placement, and everything that reads geometry lays the text out first. Pros: one source of truth. Cons: every reader of geometry has to load the font, asynchronously, workers included; the server can't check operation targets against outlines; a project whose font can't load can't be machined or even drawn; a font update moves the cuts of existing projects.
2. **Settings and outlines, the outlines stored as a drawing's shape.** A text item is a drawing with its settings attached. Its outlines are laid out when the settings change and stored like an imported drawing's shapes, in stock coordinates. Pros: whatever reads geometry stays as it is, as ADR-0055 wanted; a project machines the same text after a font changes or fails to load; the server validates targets as for any drawing. Cons: the outlines duplicate what the settings describe, and the two must be changed together.

## Decision

Option 2.

- **A text item is a drawing with `text`:** `Drawing.text` holds `{ text, font, height, align, placement }`; a drawing without it is an imported one. `font` is the font's id (bundled, #349, or uploaded, #352). `height` is the cap height in millimetres. `align` is `left`, `center` or `right`. `placement` is `{ position, rotation, mirrored }`: the text's origin, the point on its first line's baseline at the alignment (its start, centre or end), lands at `position` in stock coordinates; the text is mirrored left to right first if `mirrored`, then turned `rotation` degrees counter-clockwise about its origin. Everything ADR-0055 says of drawings holds for text items: selecting, moving, resizing, rotating, mirroring, duplicating, removing, the border *Fit to stock* leaves, design alignment, and that a project with a model takes none.
- **Its outlines are one shape:** a text drawing has exactly one shape, holding every glyph's paths in stock coordinates, which the schema checks. Editing the text, font, height or alignment lays the text out again (#348) and replaces that shape's paths in one undo step, keeping its id.
- **Operations target the shape, which keeps its id:** an operation machining a text item targets its one shape, so it still does after an edit. Path indices don't survive a new layout, so an edit turns the item's targets that list paths into whole-shape targets, and drops the profile tabs lying on its old paths, which may no longer lie on any.
- **Transforms rewrite the outlines and the placement together:** a move, scale, rotation or mirror rewrites the shape's points as for any drawing, and maps the placement with the same transform: `position` moves, a turn adds to `rotation`, a mirror flips `mirrored` and the rotation's sense, and a scale multiplies `height`, so resizing a text item is setting its height. Design alignment moves `position` with the shapes. Re-laying out the text from its settings gives back the shape a transform made, up to rounding.
- **Converting to a drawing (T8)** removes `text`; the shape and the operations targeting it stay as they are.
- **Schema version 19** adds `text`. Existing documents have no text items and migrate unchanged.

## Consequences

- Toolpaths, posts, the viewport, picking, snapping, bounds, design alignment, archives and `.furrow` files handle text items without change.
- The document carries every text item's outlines: a few kilobytes per line of text, small next to an imported drawing.
- A text item can't be split into letters or have only some letters machined after an edit; picking some of its paths works until the next edit.
- A document edited by hand can store outlines that don't match its settings; the next edit of the text lays it out again.
- A text item uses a font only when edited: a project whose uploaded font is missing still machines, but its text can't be changed until the font is uploaded again.
