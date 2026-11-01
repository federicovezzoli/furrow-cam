# ADR-0071: Relief passes go over a wall no lower than the tool anywhere along the level move

- **Status:** Proposed
- **Date:** 2026-11-01
- **Deciders:** Federico Vezzoli
- **Related:** PRD-0005 (S4), ADR-0033, ADR-0040, ADR-0070; issues #151, #439. Supersedes ADR-0040's height for going over.

## Context

Where a pass can't go straight between two points the tool is dropped at (ADR-0040, kept by ADR-0070), it goes over at the higher of the two: along at that height, then straight down (or straight up, then along). The level move only knows the tool's height at its ends. On a steep face that keeps rising into the top edge of a wall the tool then drops off, the tool must be higher than both ends partway along, and the level move cuts into the face: up to the face's slope times the distance between the two points, about 0.03 mm for a face rising 4.8 in 1 on 0.1 mm cells (#439).

## Decision

- **Over no lower than the tool anywhere between the two points** (`sampleMoves` in `@furrow/cam-core`): the level move is also no lower than the tool dropped halfway between them with its profile widened by half the distance between them, as ADR-0033's roughing widens its profile. That height is at least the tool's anywhere along the move.
- `ToolDropper.dropPoint` takes the widening, so finishing passes, links and spirals pass it through the `between` callback they already give `sampleMoves`.

## Consequences

- No level move over a wall cuts below the model as the heightmap holds it; ADR-0070's micrometre below the tool on smooth steep faces is unchanged.
- One more drop only where a pass goes over a wall; on ADR-0070's pyramid the moves are unchanged (5,493, none straight up or down).
- Where the tool was already clear, passes may go over a wall slightly higher than before, so G-code changes there.
