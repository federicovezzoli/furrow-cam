# ADR-0073: Relief passes don't look between samples close in height

- **Status:** Proposed
- **Date:** 2026-11-01
- **Deciders:** Federico Vezzoli
- **Related:** PRD-0005 (S4), ADR-0030, ADR-0033, ADR-0040, ADR-0070, ADR-0071; issues #439, #443. Restates ADR-0040's guarantee.

## Context

`sampleMoves` drops the tool between two samples only where it rises or drops more than their spacing (ADR-0040, ADR-0070). Between samples closer in height, `simplifyHeights` merges them into straight moves that never go below a *sample* but know nothing about the tool between them. The tool can rise and fall back within one cell: a fin narrower than a cell, or a tall cell just beside the pass, lifts it between two samples while both stay low, and the straight move cuts into it. With 0.1 mm cells, a 0.05 mm wide fin at -3.5 between samples at -4 and -4.05 is cut about 0.5 mm deep (#443). On smooth surfaces the same gap is a few micrometres, where a ball end mill's path bulges above the straight line between cells.

The options considered:

- Drop the tool at each sample pair's midpoint with its profile widened by half a cell, and go over where that is well above both samples. That catches fins, but it drops the tool about twice as often on every pass, and a bump no higher than the higher sample can still be cut by up to the two samples' difference.
- Drop every sample with the profile widened by half a cell, as ADR-0033's roughing does. No extra drops, but it leaves more on every curved surface and still lets a straight move dip below a fin.
- Accept the limit.

## Decision

- **Accept the limit:** finishing passes, links and spirals keep merging samples close in height without looking between them.
- **ADR-0040's guarantee is restated:** no straight move cuts below the model as the heightmap holds it, *except* for features narrower than a cell between two samples less than a cell apart in height. Cells are 0.1 mm, or a twentieth of the tool's radius if smaller (larger only where `MAX_RELIEF_CELLS` coarsens a large model, which is already reported).

## Consequences

- Features narrower than a cell (0.1 mm or less with common tools) can be cut into, sometimes much deeper than their width; such features are below what the heightmap reliably holds anyway (ADR-0030), and rarely survive in wood.
- Finishing time and moves are unchanged; no G-code changes.
- If thin features turn out to matter (fine engraving with a small tool, for instance), the midpoint drop above is the fix to revisit.
