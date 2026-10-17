# ADR-0040: Relief passes go over steep jumps between samples instead of cutting across them

- **Status:** Proposed
- **Date:** 2026-10-17
- **Deciders:** Federico Vezzoli
- **Related:** PRD-0005 (S4, S10), ADR-0030, ADR-0032, ADR-0033, ADR-0039; issue #151. Supersedes ADR-0032's *Merging* in part.

## Context

ADR-0032 merges the samples along a finishing pass, and along a zig-zag link, into straight moves that never go below a sample. That isn't enough near a wall a flat end mill drops off: the tool's height jumps between two samples, from the top of the wall to its foot, and the straight move between them descends diagonally. Partway along it, the cutter's rim is still over the top of the wall but well below it, and nicks the wall's top edge. On a step 6 mm high, simulating the passes cut a notch down the whole wall, about a cell wide (#151). ADR-0039's spiral went over such jumps with a rule of its own.

## Decision

- **One rule for finishing passes, links and spirals** (`sampleMoves` in `@furrow/cam-core`): samples are merged with `simplifyHeights` as before, except between two samples where the tool rises or drops more than their spacing (steeper than 45°).
- **Between such samples**, the tool is dropped at points spaced evenly between them, about as many as the jump is high in spacings, up to 16, and the pass follows them. Where it still rises or drops more than their spacing between two of them, it goes over at the higher one: along at that height, then straight down (or straight up, then along).
- **Linear roughing is unchanged:** ADR-0033 already drops its tool with its profile widened by one sample's spacing, which keeps the moves between samples clear, and its simulation tests check it.

## Consequences

- No straight move cuts below the model as the heightmap holds it. A wall is still only known within a cell (ADR-0030), so on a grid turned at another angle than the wall a pass may still reach up to a cell into it.
- Following the tool between steep samples cuts steep faces more closely than going straight over, and leaves less for rest machining to find; it drops the tool a few more times only where passes cross walls and steep faces.
- Parallel passes change where they cross steep faces and walls, so their G-code changes there.
