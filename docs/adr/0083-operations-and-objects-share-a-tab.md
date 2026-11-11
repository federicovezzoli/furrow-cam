# ADR-0083: Operations and objects share a sidebar tab, one above the other

- **Status:** Proposed
- **Date:** 2026-11-11
- **Deciders:** Federico Vezzoli
- **Related:** ADR-0009, ADR-0080; supersedes in part ADR-0080 (the Objects pane as a third tab)

## Context

ADR-0080 put the Objects pane in a third tab of the left column, between Operations and Properties. Both lists are usually a few rows long, so each tab leaves most of the column empty, and the usual work goes back and forth between them: select objects in the tree, add an operation, check its targets in the tree.

## Options considered

1. **Keep three tabs.** Pros: no change. Cons: one short list at a time, and a tab switch for each round trip.
2. **Operations above objects in one tab, split by a resizable handle; Properties stays its own tab.** Pros: both lists in view, the split sized to the project. Cons: less height for each list in a large project, which the handle gives back.
3. **All three stacked.** Cons: the project properties are a long form, and ADR-0080 keeps them apart from what is selected.

## Decision

We will use option 2. The first tab, still **Operations**, holds the operations list on top and a headed **Objects** section below, each scrolling on its own, with the G-code export and simulate footer under both. The split is remembered by the host with the column sizes (`settings.layout.sidebar`). **Properties** stays a tab of its own, for the project only.

## Consequences

- The tour's Objects step opens the Operations tab; its `objects` anchor moves to the section.
- A layout saved before this has no sidebar split, so the two start at half each.
