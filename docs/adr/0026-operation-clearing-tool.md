# ADR-0026: An operation may cut with a second, clearing tool

- **Status:** Proposed
- **Date:** 2026-10-14
- **Deciders:** Federico Vezzoli
- **Related:** PRD-0001 (R16), ADR-0003, ADR-0004, ADR-0025

## Context

So far every operation cut with one tool: its `tool` snapshot (ADR-0003). The toolpath was a single list of moves, and the post-processor, the toolpath preview and the simulation all took the tool from `operation.tool`.

A V-carve with a flat bottom (PRD-0001 R16, issue #97) needs two tools. The V-bit carves down to the maximum depth. Where a shape is wider than the bit reaches at that depth, a flat end mill clears the floor flat, and the V-bit carves the walls around it. Both belong to one operation: the end mill's area and depth come from the V-bit's angle, tip and maximum depth, and changing either changes both toolpaths.

## Options considered

1. **A second tool inside the operation**: the V-carve's params hold a `flatBottom: { tool }` snapshot, and its toolpath has `clearing` moves for that tool besides its own `moves`. One operation, one place to edit it. Consumers that care about tools must look at both.
2. **A separate pocket operation**, created alongside the V-carve and kept in step with it: no new concepts, but the pocket's area is derived from the V-carve's params, so it would have to be recomputed or locked on every edit, and the user could break the pair by editing or deleting one.
3. **A list of steps per toolpath** (`steps: { tool, moves }[]` for every operation): general, but changes every generator, test and consumer for a case only V-carving has today.

## Decision

- We will use **option 1**. The clearing tool is a snapshot inside the operation's params, like `tool`. `clearingTool(operation)` in `@furrow/document` returns it, or `null`. Today only a V-carve with a flat bottom has one, and it must be a flat end mill.
- `Toolpath` gains an optional **`clearing`** list of moves, under the same contract as `moves`. The clearing moves are cut **before** the operation's own moves, so the end mill hogs out the floor before the V-bit finishes the walls.
- The post-processor writes an operation with clearing moves as **two steps**, named `<operation>, clearing` and `<operation>`, each with its tool and with a tool change between them when the bits differ (`postSteps` in `@furrow/post`).
- The preview draws the clearing moves in the clearing tool's colour. The simulation cuts them with the clearing tool's shape. Editing a library bit re-snapshots it wherever it is used, as the clearing tool too.

## Consequences

- Operations that need a second tool in future (a finishing tool for pockets, rest machining) can follow the same pattern: a snapshot in the params, `clearingTool`, `clearing` moves. If one ever needs more than two tools, option 3 replaces this.
- Anything new that reads `operation.tool` to describe what an operation cuts with must also check `clearingTool`.
- The operation's colour swatch in the Operations pane still shows only its own tool.
