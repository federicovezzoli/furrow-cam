# ADR-0085: A project holds several models, each machined on its own

- **Status:** Accepted
- **Date:** 2026-11-15
- **Deciders:** Federico Vezzoli
- **Related:** PRD-0005 (S1c, S6), PRD-0009 (D1), ADR-0030, ADR-0063, ADR-0064, ADR-0067. Supersedes the rule in ADR-0078 that a project holds at most one model.

## Context

ADR-0078 lets a project hold drawings and at most one model, leaving several models open (its option 3). Jobs like two emblems on one board, or a terrain beside an image relief, need two projects lined up on the same zero by hand (#596).

As with ADR-0078's rule, only imports enforce it (`canImportModel` and its callers in the workspace and the MCP server). The document holds a list of models, every 3D operation names its model by id, and the viewport, the Objects pane, visibility, holding tabs and the MCP tools all work by id.

What isn't ready for several models is the relief toolpath: a 3D operation builds its height map from its own model only (ADR-0030). Past that model, within a `margin` or `stock` boundary (ADR-0064), it sees empty stock and clears it to the floor, so it would cut flat any other model there. Even within the `model` boundary the tool reaches one radius past the outline.

## Options considered

1. **Exact surfaces:** rasterise the other visible models into the operation's height map, so the tool follows them. Pros: no model is ever gouged, and one stock-boundary finish finishes them all. Cons: the grid has to cover the whole boundary rather than one model, the heightmap cache and mesh loading change, and every operation recomputes when any model moves.
2. **Keep-out boxes:** the tool never goes below another model's top over that model's footprint. Pros: safe, a small change. Cons: leaves stock around the other models, and changes toolpaths in a way the user doesn't see.
3. **Warn only:** each operation still machines its own model; it warns when the area it cuts reaches another visible model. Pros: the smallest change, toolpaths unchanged, and the simulation shows exactly what happens. Cons: the G-code can still cut into the other model if the warning is ignored.

## Decision

We will use option 3:

- A project holds any number of drawings and models. Every import (STL, STEP, terrain, image relief), in the app and the MCP server, adds a model.
- A 3D operation machines only its model. It warns (`toolpath.reachesOtherModel`) when its cut area, its boundary grown by the tool's radius, overlaps the footprint of another visible model on the same side; hidden models are not machined and not warned about.
- The toolpath's input holds whether it reaches another model, not the other models, so moving a model recomputes another model's toolpaths only when their warning comes or goes.
- The message *"A project holds only one 3D model"* goes, in every interface language.

## Consequences

- One project and one G-code file for a board with several reliefs.
- The user keeps 3D operations on adjacent models to the `model` boundary, or moves the models apart, as the warning says.
- No schema change and no migration: a project with several models also opens in older versions of the app, which only refuse to import another.
- Options 1 and 2 stay open if the warning turns out not to be enough.
