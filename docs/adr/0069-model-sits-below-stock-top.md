# ADR-0069: A model's top can sit below the stock top

- **Status:** Proposed
- **Date:** 2026-11-01
- **Deciders:** Federico Vezzoli
- **Related:** PRD-0005 (S2), ADR-0031, ADR-0034, ADR-0060, ADR-0063; #434

## Context

ADR-0031 puts a placed model's top at the stock top (`z = 0`). `depth` sets the model's height, so it can't move the model down without stretching it. Users need a relief sunk a few millimetres into the stock:

- **to save a part**: a relief roughed too deep (for example, after a machine lost Z steps) can only be recovered by machining the whole relief lower. Moving the work zero by hand doesn't work, because a Z probe at the tool change resets it;
- **to leave material above the relief**: a frame standing proud of a carved panel, or a relief that starts below a surface already flattened.

## Options considered

1. **Shift the work zero** (`G10 L20`, or a Z offset in the post-processor). Pros: no document change. Cons: the touch-off pad and every other operation would move too, and a probe macro silently undoes a hand-set offset.
2. **A `top` in the placement**: how far the model's top sits below the stock top. Pros: only the model moves; every toolpath, the preview and the warnings follow from its transform. Cons: a schema migration.

## Decision

Option 2. `ModelPlacement.top` is how far below the stock top the model's top sits, in millimetres, `≥ 0`. Version 30 of the document gives existing models `0`. `depth` keeps its meaning, the model's own height, so the model reaches `top + depth` into the stock. `modelTransform` and `placedModelBox` move the model down by `top`. The viewport, relief roughing and finishing, rest machining and both sides of a two-sided project all work from these two, so they follow it. Roughing levels still start at the stock top, so the material above the model is cleared. The touch-off pad stays at the stock top. Holding tabs stay at the parting plane.

An imported model starts at `top = 0`. Turning, scaling, *Fit to stock* and setting the depth keep the user's `top`. A model whose `top + depth` is more than the stock's thickness gets the existing warning. Making a project two-sided puts the parting plane halfway down the deepest model, from its top.

This supersedes ADR-0031's rule that the model's top is always at the stock top.

## Consequences

- A sunk model can be machined lower without touching the machine's zero or the other operations.
- The model properties panel has a *Top below stock* field next to *Depth*.
- Documents saved with `top` above 0 don't open in older releases. The schema version bump makes them refuse cleanly.
