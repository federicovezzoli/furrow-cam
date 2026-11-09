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
- **Double click** on a drawing **enters** it. The other objects are dimmed and can't be picked, and clicks select paths as today (Shift/Ctrl/Cmd+click toggles, *Select inside* works). **Esc**, or a double click outside the drawing, leaves it with its paths still selected. Double clicking a text item enters it as well and focuses its text field.
- **Alt+click** selects a path directly, without entering its drawing, as a direct-selection tool does (Alt+Shift+click toggles it).
- Hover follows the same level: all of the drawing's paths when outside, the path when inside.
- Picking an operation's targets, editing tabs or start points and picking the zero keep taking the clicks, as today.

### Operations

Targets stay as ADR-0018 defines them, so their schema doesn't change. Adding an operation with objects selected targets all their shapes (`paths: null`). With paths selected, it targets those paths. A selected operation highlights its targets in the viewport and in the pane.

### Objects pane

- The left column gets two tabs, **Objects** and **Operations**. The Properties pane stays for the project only.
- A tree: each drawing (its name, a text icon for text items), then its shapes (name, else layer, else "Shape n"), then a shape's paths when it has more than one. Rows below a drawing load only when it is expanded. The model is its own row.
- Selecting a row selects that object, shape (all its paths) or path, and enters its drawing when the row is inside one. The viewport and the tree show the same selection. It is an ARIA tree, usable from the keyboard, which closes ADR-0023's follow-up.
- Drawings, shapes and the model each have an **eye** (visible) and a **lock**.

### Visibility and lock are saved

`hidden: boolean` and `locked: boolean` are added to `Drawing`, `Shape` and `Model` in a new schema version. The migration sets both to `false`.

- **Hidden:** not drawn, not pickable and **not machined**. Toolpath generation, the simulation and G-code export skip hidden targets, as they skip targets no longer in the document. An operation whose targets are all hidden is off: its checkbox shows as off and greyed, with the reason in its tooltip, and it can't be turned on while they stay hidden. An operation with only some targets hidden cuts the visible ones and shows a mark. This state is derived from the targets, not written to `enabled`, so showing the object again brings its operations back as they were, and `enabled` keeps the user's own choice.
- **Locked:** drawn, but not pickable or draggable in the viewport, so a terrain or a background drawing can sit under the work. It can still be selected from the pane, to edit its properties or unlock it.
- A hidden or locked drawing hides or locks its shapes. A shape's own toggles apply only inside a drawing that is visible and unlocked.
- Hiding or locking is one undo step, like any document change.

## Consequences

- One click selects a whole map, lettering or outline, and one operation cuts it. Single paths take a double click or the pane.
- Hiding an object is a quick way to leave it out of a job without deleting it or its operations. Every reader of `operation.enabled` (toolpath and simulation schedulers, G-code export, the Operations pane) has to go through one helper that also checks hidden targets.
- What a project holds is listed, with names and layers. Overlapped and hidden objects can be reached, and selection works from the keyboard.
- The schema version goes up, and older app versions can't open documents saved with it (the schema is strict). The MCP server reports visibility and lock in `get_project` but does not need to change them.
- Viewport picking, hover, the drawing highlight and drag, the tour and the demo scripts (`data-tour` and `data-demo` anchors) and the component tests that expect a click to select a path all change.
- Shapes are still the imported elements: SVG groups and nested DXF blocks are not kept as levels of the tree. Keeping them is a later decision.
