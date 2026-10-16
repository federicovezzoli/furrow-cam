# ADR-0034: A model's depth capped by the stock follows its thickness

- **Status:** Proposed
- **Date:** 2026-10-16
- **Deciders:** Federico Vezzoli
- **Related:** PRD-0005 (S2), ADR-0031

## Context

ADR-0031 caps a new model's depth at the stock's thickness. A model imported into a stock thinner than it is squashed to fit, and making the stock thicker afterwards left it squashed: its relief looked lost, and only the depth field brought it back.

## Decision

When the stock's thickness changes, a model's depth follows it while the stock caps it, in the same undo step:

- A depth equal to the old thickness and below the model's own height at its scale becomes the new thickness, up to that height.
- A depth deeper than the new thickness becomes the new thickness.
- Any other depth, such as one set below the stock in the depth field, stays. Flat models have no depth to change.

This supersedes ADR-0031 in part: its import rule stands, and stock changes now update capped depths.

## Consequences

- A model imported into a thin stock gets its relief back once the stock is thick enough, and thinning the stock again caps it.
- A depth set on purpose to exactly the stock's thickness follows the stock too.
- A model deliberately set deeper than the stock is capped at the next thickness change.
