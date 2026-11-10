# ADR-0080: Objects are selected first, their paths inside them, with an Objects pane

- **Status:** Proposed
- **Date:** 2026-11-09
- **Deciders:** Federico Vezzoli
- **Related:** PRD-0009 (D2), PRD-0010, PRD-0014, ADR-0018, ADR-0023 (`0024-selection-in-the-viewport-only.md`), ADR-0055, ADR-0059, ADR-0078. Supersedes ADR-0023 and the selection paragraph of ADR-0018.

## Context

A project now holds several drawings (imported SVG and DXF files, ADR-0055), text items (ADR-0059) and a model, which can be a terrain (ADR-0077), all together (ADR-0078). The document already has three levels: a **drawing** groups **shapes** (one per imported element, with `name` and `layer`), and a shape holds **paths**.

The workspace selects only paths (ADR-0018, ADR-0023):

- A click in the top view selects the one path under the cursor (`PathPick`).
- The drawing is never selected itself. Its highlight, drag, and properties panel with size, rotation and *Duplicate* show when every selected path belongs to one drawing (`selectedDrawingId`). Moving a drawing means clicking any one of its paths, and Shift+clicking a path of another drawing makes the panel disappear.
- A drawing with many paths (a map, lettering, a terrain outline) can only be cut as a whole by clicking each path or using *Select inside*.
- Nothing lists what the project holds. A drawing hidden under another, or under the model, can't be reached, and shape names and layers are shown nowhere. ADR-0023 left keyboard selection as an open follow-up, and PRD-0009 left open "should the drawings be listed somewhere?".

Vector editors (Illustrator, Inkscape, Affinity) work the same way: a click selects the object, a double click enters it to select what is inside, and a Layers panel lists every object with visibility and lock toggles.

## Options considered

1. **Keep path selection and only make the drawing state clearer** (a visible "drawing selected" header). Cheap, but it leaves multi-path drawings tedious to target and nothing listed.
2. **Object first, paths inside, plus an Objects pane.** Clicks select whole objects, a double click enters one, and a pane lists objects, shapes and paths with visibility and lock. Familiar from vector editors and answers both open questions. Costs a schema version (visibility and lock are saved) and a rework of viewport picking.
3. **An Objects pane only, viewport unchanged.** Gives a list and a keyboard path, but the viewport stays path-first and still disagrees with the pane on what a click selects.

## Decision

We will use option 2.

### Selection in the viewport

- **Click** selects the **object** under the cursor: the drawing a picked path belongs to, otherwise the model (paths still win over the model under them, ADR-0078). Shift/Ctrl/Cmd+click adds or removes objects. A click on nothing clears the selection.
- The selection stays a set of paths (ADR-0018): selecting a drawing selects all its paths, and the drawing whose properties show is still the one every selected path belongs to. What changes is what a click puts in the set. The workspace adds only which drawing is entered, if any.
- A selected drawing shows its properties over the viewport and can be dragged, as today. With several drawings selected, no properties panel shows, but operations can still be added.
- **Double click** on a drawing **enters** it and selects the path under the cursor (Shift/Ctrl/Cmd+double click inside the entered drawing adds it instead). The other drawings are dimmed, nothing outside the drawing can be picked (the model included), and clicks select paths as today (Shift/Ctrl/Cmd+click toggles, *Select inside* works). **Esc**, or a double click outside the drawing, leaves it with its paths still selected. Selecting anything outside it from the interface (a duplicate, a new text item, an import) leaves it too.
- **Alt+click** selects a path directly, without entering its drawing, as a direct-selection tool does (Alt+Shift+click toggles it).
- Hover follows the same level: all of the drawing's paths when outside, the path when inside or while Alt is held.
- Picking an operation's targets, editing tabs or start points and picking the zero keep taking the clicks, as today.
- The orbit view selects whole drawings and the model the same way, where the cursor meets the stock top; double click, entering a drawing and Alt+click stay in the top view, which has the precision single paths need (#544).
- **Esc** steps back one thing at a time, in either view: it ends picking the zero or editing in the viewport, else leaves an entered drawing, else clears the selection (#544).

### Operations

Targets stay as ADR-0018 defines them, so their schema doesn't change. Adding an operation with objects selected targets all their shapes (`paths: null`). With paths selected, it targets those paths. A selected operation highlights its targets in the viewport and in the pane.

### Objects pane

- The left column, which already has the **Operations** and **Properties** tabs, gets a third, **Objects**, between them. Properties stays for the project only.
- A tree: each drawing (its name, a text icon for text items), then its shapes (name, else layer, else "Shape n"), then a shape's paths when it has more than one. Rows below a drawing load only when it is expanded. The model is its own row.
- Selecting a row selects that object, shape (all its paths) or path, and enters its drawing when the row is inside one. The viewport and the tree show the same selection. It is an ARIA tree, usable from the keyboard, which closes ADR-0023's follow-up.
- Drawings, shapes and the model each have an **eye** (visible) and a **lock**.

### Visibility and lock are saved

`hidden` and `locked` are added to `Drawing`, `Shape` and `Model` in a new schema version, each stored only as `true` and absent otherwise. Absent means shown and unlocked, so existing documents need no change: the migration only bumps the version, which keeps older releases from opening documents that use the flags. Every place that builds a shape, drawing or model (the importers, text items, terrain, fixtures) stays as it is, and a duplicate drops the flags.

One function, `machinedDocument` in `@furrow/cam-core`, gives the document as it is machined, with every operation that cuts a hidden object off. The toolpath and simulation schedulers, G-code export, the MCP server and the viewport's toolpaths all read operations through it.

- **Hidden:** not drawn, not pickable and **not machined**. An operation that cuts any hidden object (a shape it targets, or its model) is off: its checkbox shows as off and greyed, with the reason in its tooltip, and it can't be turned on while the object stays hidden. It is not cut in part: without a hidden island a pocket would clear what the island stands for, and a profile's tabs and start points would move onto the shapes left. This state is derived from the targets, not written to `enabled`, so showing the object again brings its operations back as they were, and `enabled` keeps the user's own choice. Export says when every enabled operation is off this way, rather than that none is enabled.
- **Locked:** drawn, but not pickable or draggable in the viewport, so a terrain or a background drawing can sit under the work; a drawing holding a locked shape isn't dragged either. It can still be selected from the pane, to edit its properties or unlock it.
- Hiding an object drops it from the selection, and hidden shapes give the zero picker nothing to snap to.
- A hidden or locked drawing hides or locks its shapes. A shape's own toggles apply only inside a drawing that is visible and unlocked.
- Hiding or locking is one undo step, like any document change.

## Consequences

- One click selects a whole map, lettering or outline, and one operation cuts it. Single paths take a double click or the pane.
- Alt+click may not reach the app on Linux desktops that move windows with Alt+drag (KDE, Xfce). Double click works everywhere, so the hints name it first.
- Hiding an object is a quick way to leave it out of a job without deleting it or its operations. Every reader of `operation.enabled` has to read it through `machinedDocument`, or a hidden object would still be cut.
- What a project holds is listed, with names and layers. Overlapped and hidden objects can be reached, and selection works from the keyboard.
- The schema version goes up, and older app versions can't open documents saved with it (the schema is strict). The MCP server reports visibility and lock in `get_project` but does not need to change them.
- Viewport picking, hover, the drawing highlight and drag, the tour and the demo scripts (`data-tour` and `data-demo` anchors) and the component tests that expect a click to select a path all change.
- Shapes are still the imported elements: SVG groups and nested DXF blocks are not kept as levels of the tree. Keeping them is a later decision.
