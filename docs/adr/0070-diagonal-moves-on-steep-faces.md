# ADR-0070: Relief passes go straight down steep faces and merge within 0.02 mm

- **Status:** Proposed
- **Date:** 2026-11-01
- **Deciders:** Federico Vezzoli
- **Related:** PRD-0005 (S4), ADR-0030, ADR-0032, ADR-0039, ADR-0040; issues #151, #435. Supersedes ADR-0040's rule for steep samples, and ADR-0032's 0.01 mm merge tolerance.

## Context

ADR-0040 goes over at the higher of two points wherever the tool rises or drops more than their spacing, which keeps a pass from nicking a wall's top edge (#151). Steepness alone doesn't tell a wall from a steep face, though: on any face steeper than 45° the pass went up or down in square steps, and merging within 0.01 mm kept many tiny moves elsewhere. Finishing a 200 × 200 mm relief gave 750,000 moves, 25% of them straight up or down, each a corner the machine nearly stops at and, capped at the Z feed by the post-processor, a feed change too. On a controller with modest Z acceleration the tool never reached the programmed feed on steep faces (#435).

## Decision

- **A steep face, not a wall** (`sampleMoves` in `@furrow/cam-core`): between steep samples the tool is still dropped at points spaced evenly between them, as ADR-0040 does. It now goes straight from one point to the next wherever that move passes halfway between them no more than half the merge tolerance above the tool dropped there, and no more than 0.001 mm below it: the face is smooth there. The tool dropped onto cell centres bulges about that much above a straight line between them, even on a flat face, so a stricter check would bring the steps back. Elsewhere (a wall the tool drops off between them, or with no way to drop the tool between samples) it goes over at the higher one as before.
- **Merged across steep faces:** the points between two straight-up or straight-down moves are merged with `simplifyHeights` as one run, so a steep face, and the level run leading to a step, take one move each wherever one slope fits.
- **Merge tolerance 0.02 mm** (`RELIEF_TOLERANCE`), for finishing passes, links, spirals and roughing: twice what ADR-0032 chose, still well below what wood shows.

## Consequences

- On a pyramid whose faces rise 1.6 in 1, parallel finishing with a 3 mm ball end mill takes about 5,500 moves instead of 17,800, and one straight-up or straight-down move instead of 8,285. Walls a flat end mill drops off are still gone over, and #151's simulation tests still pass.
- A move may now pass up to 0.02 mm above the dropped tool, and on a smooth steep face up to 0.001 mm below it halfway between two points it was dropped at, less than merging between samples already cuts across curves (ADR-0030).
- Every 3D operation's G-code changes: fewer, longer moves.
