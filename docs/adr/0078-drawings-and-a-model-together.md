# ADR-0078: A project holds drawings and one model together

- **Status:** Proposed
- **Date:** 2026-11-08
- **Deciders:** Federico Vezzoli
- **Related:** PRD-0009 (D1), PRD-0010, PRD-0014 (T7), PRD-0005 (S6), ADR-0031, ADR-0055, ADR-0060, ADR-0067. Supersedes the rule in ADR-0055 that a project never holds a model and drawings together.

## Context

ADR-0055 lets a project hold several drawings or one model, never both, because "mixing them would make every placement and operation handle both kinds at once". Real jobs mix them: a relief with a profile cut-out around it, a carved emblem on a sign with lettering, a terrain with its outline (PRD-0014 T7). Today the user has to split such a job into two projects and line them up on the same zero by hand.

What the rule protects turns out to be small:

- It is enforced only by `canImportDrawing` and `canImportModel` (`packages/workspace/src/stores/geometry-actions.ts`), their callers in the workspace's import paths, and the MCP server's model import. The document schema has never forbidden both.
- Drawings and models are placed independently, and design alignment already moves all of them together by their joint bounding box (ADR-0055).
- 2D operations target shapes and 3D operations the model; neither reads the other kind.
- The simulation and rest machining start from the stock the earlier operations left, whatever their kind.
- Two-sided projects already map both models and drawings into the bottom side's coordinates (ADR-0060).

## Options considered

1. **Keep the rule** and cut the outline in a second project. Pros: nothing changes. Cons: two projects, two G-code files and a hand-made alignment for one of the most common relief jobs.
2. **Allow drawings and one model together.** Pros: one project for the whole job, and the rule's two checks get simpler. Cons: the viewport, selection and operation target picking have to work with both on screen.
3. **Allow several models as well.** Not needed by any requirement; a later decision if one asks.

## Decision

We will use option 2:

- A project holds any number of drawings (imported files and text items) and **at most one model**, in any order of import. A drawing can always be imported; a model can be imported while the project has none.
- The message *"A project holds SVG and DXF drawings or one 3D model, not both"* becomes *"A project holds one 3D model"*, in every interface language.
- Placement, operations, the simulation, rest machining, two-sided projects, project archives and the document schema are unchanged.
- In the viewport, clicking where a shape overlaps the model selects the shape, and when picking a 2D operation's targets only shapes are pickable.
- The MCP server follows the same rule.

## Consequences

- A relief and its cut-out, or a sign with a carved emblem, are one project and one G-code file.
- A 2D operation can cut through the model where they overlap; it is the user's choice, and the simulation shows it.
- No schema change and no migration: the rule only ever guarded imports, so a project mixing both also opens in older versions of the app.
- Allowing several models stays open (option 3).
