# ADR-0084: V-carve inlays come from a start depth and a boundary path among the targets

- **Status:** Proposed
- **Date:** 2026-11-12
- **Deciders:** Federico Vezzoli
- **Related:** ADR-0025, ADR-0026, ADR-0055, PRD-0001 R16, #553

## Context

A V-carve inlay is a V-carved pocket (the female part) and a plug (the male part) carved from the mirror image of the same shape, turned upside down and glued into the pocket. The plug is carved inside out: the waste round the shape is carved and the shape is left standing, and the carve starts below the stock top so that the plug's sloped walls meet the pocket's before the plug bottoms out. A V-carve always started at the stock top and carved only inside its closed paths.

With a V-bit of half angle α, a pocket carved to depth D is, at depth y, the shape inset by y·tan α. A plug carved from depth S is, at depth z below its top, the mirrored shape inset by (S − z)·tan α. Turned over and pushed in until the walls meet, plug depth z sits at pocket depth S − z, which is D − g when S = D − g: the plug's top stops g above the pocket's floor, the glue gap.

## Options considered

1. **A start depth on V-carve, and the boundary as a closed path among the targets.** V-carve already carves its targets even-odd, so a rectangle round the mirrored shape, targeted with it, carves the area between them. Pros: one new number; the boundary can be edited or redrawn like any path; no new kind of reference. Cons: the boundary is geometry the user sees in the drawing.
2. **A start depth and a boundary margin on V-carve.** cam-core grows the targets' outline by the margin and carves inside out. Pros: nothing drawn. Cons: a field that only means something for plugs, and a boundary that can't be shaped.
3. **A start depth and a separate boundary target.** Pros: explicit. Cons: a second target list every action, migration and the MCP server would have to handle.

## Decision

We will use option 1. `VCarveParams.startDepth` (default 0) moves the whole carve down: the bit's tip is `startDepth` deep on the paths, `maxDepth` and the flat bottom are measured from there, and above it the cone cuts the walls on up to the stock top. The deepest the bit goes below `startDepth` is also limited by the cone, which has to reach the stock top.

*Make inlay* adds, in one undo step, from the selected closed paths: the pocket, a V-carve of them from the stock top, `D` deep, with a flat bottom; and a mirrored copy of them as a new drawing (ADR-0055) to the right, with a rectangle round it, and the plug, a V-carve of both from `D − g`, `D` deep below it, with a flat bottom. The rectangle leaves room for the walls on both sides and the end mill between them. Both parts are on the side in view, so one simulation shows both; the user moves the plug's drawing, or turns one operation off, to cut each from its own wood.

## Consequences

- A flat-bottom end mill is required: the plug's waste is wider than the V-bit reaches.
- Documents get `startDepth: 0` on every V-carve (schema version 39); their G-code is unchanged.
- The stepped and pocket inlay variants are out of scope.
