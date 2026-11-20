# ADR-0086: Holding tabs belong to the stock, so one-sided jobs have them too

- **Status:** Accepted
- **Date:** 2026-11-16
- **Deciders:** Federico Vezzoli
- **Related:** PRD-0005 (S13), PRD-0011 (B5), ADR-0063, ADR-0069; #357, #606, #616. Supersedes in part ADR-0063: holding tabs are no longer a setting of the two-sided setup.

## Context

ADR-0063 made holding tabs a setting of the two-sided setup (`TwoSided.tabs`). That assumed a one-sided 3D job stays held by the stock left under the model. That holds only while the model is shallower than the stock. A model that reaches the stock bottom (`top + depth ≥ thickness`, such as a carved cut-out shape) is cleared to the stock bottom all round by one-sided roughing and finishing. The part comes loose on the last pass, and the user can't add tabs and gets no warning. The workaround is to leave a skin and cut the part out with a profile with tabs, but that needs a drawn outline, which an STL model doesn't have.

## Options considered

1. **Warn only.** Pros: no schema change. Cons: the user still can't hold the part.
2. **Keep tabs in `TwoSided` and add a second copy for one-sided projects.** Cons: two settings for one thing, and turning two-sided on or off would have to move them between the two.
3. **Move tabs to the stock** (`Stock.tabs`): one setting, whatever the sides. Pros: turning two-sided on or off keeps the tabs; one-sided and two-sided share placement, dragging and the toolpath code. Cons: a schema migration.

## Decision

Option 3. `Stock.tabs` is `HoldingTabs | null`, with the same fields as before (`width`, `thickness`, `fullHeight`, `positions`). Version 41 of the document moves each two-sided project's `twoSided.tabs` there unchanged, and gives every other project `null`.

- **Height:** one-sided, a tab stands `thickness` up from the stock bottom: the 3D operations cut nothing inside it below `thickness − stock thickness`. Two-sided, ADR-0063's rule is unchanged: the bottom side leaves the tab up to its thickness past the parting plane, and the top side stops at the plane over it. A full-height tab (#606) keeps the stock's whole thickness either way.
- **Limit:** `thickness` must be less than `holdingTabsDepth(stock)`: the stock's thickness, or a two-sided project's bottom side's depth. Making a project two-sided halves tabs that are too thick for its bottom side, as a deeper parting plane already did. Making it one-sided again keeps them.
- **UI:** the Stock panel has its own *Holding tabs* section, shown whenever the project has a model (or tabs already on, so they can be turned off). The user chooses, as with profile tabs.
- **Warning:** `toolpath.noHoldingTabs` now also applies to a one-sided 3D operation on a model whose bottom reaches the stock bottom, when no tab holds that model.
- **MCP:** holding tabs move from `set_two_sided` to their own tool, `set_holding_tabs`.

## Consequences

- One-sided cut-outs of a 3D model can be held to the stock and cut free by hand, as with profile tabs.
- Two-sided projects machine exactly as before: their G-code doesn't change.
- Documents saved with version 41 don't open in older releases. The schema version bump makes them refuse cleanly.
- A one-sided project whose model reaches the stock bottom now gets the holding tabs warning until the user adds tabs.
