# ADR-0007: Geometry kernel based on Clipper2

- **Status:** Accepted
- **Date:** 2026-10-08
- **Deciders:** Federico Vezzoli
- **Related:** PRD-0001 (R5–R8), ADR-0004

## Context

2.5D toolpath generation is mostly polygon geometry:

- **Offsetting** closed and open paths by the tool radius (profile inside/outside, pocket rings).
- **Boolean operations** (union, difference, intersection) to merge shapes, handle islands in pockets and clip paths to stock.
- **Point-in-polygon / containment** to classify shapes (outer contour vs. hole) and pick inside/outside.

This code runs in the browser, in Web Workers (ADR-0004), and must be robust: a self-intersecting or degenerate offset becomes a gouged part. Imported SVG/DXF geometry contains lines, arcs, circles and Béziers.

## Options considered

1. **Clipper2 (WebAssembly build or TypeScript port)**: industry-standard polygon clipping and offsetting, used by many CAM and slicer projects. Very robust on integer coordinates, fast. Polylines only: arcs and curves must be flattened.
2. **CavalierContours (Rust, WASM)**: offsets polylines with arc segments natively, so arcs are preserved for G2/G3 output. Excellent for offsets, but the JS bindings are less mature and boolean operations on many shapes are less battle-tested.
3. **JSTS (JTS port)**: buffers and booleans in pure JS, robust, but slower and float-based, with an API oriented at GIS rather than CAM.
4. **polygon-clipping / Martinez**: booleans only, no offsetting.
5. **Write our own**: rejected; offsetting robustness is notoriously hard.

## Decision

- Use **Clipper2** as the polygon kernel for offsetting, booleans and containment. The specific package (WASM build vs. TypeScript port) is chosen after a short spike comparing correctness, bundle size and speed in a Web Worker.
- Wrap it behind our own **`geometry` module** with our own types, so the kernel is replaceable and the rest of the CAM core never imports Clipper directly.
- **Internal units are millimetres as `float64`.** Conversion to Clipper's integer coordinates uses a fixed scale (initially 1 unit = 0.0001 mm) inside the adapter only.
- **Curves are flattened** (arcs, circles, Béziers → polylines) at import time with a configurable chord tolerance (default 0.01 mm). The original curve data is kept in the project document so it can be re-flattened at a different tolerance.
- G-code output is G0/G1 initially. **Arc fitting** (merging G1 runs into G2/G3) is a later post-processing step and gets its own ADR.

## Consequences

- Robust, well-understood offsetting and booleans from day one.
- Toolpaths are polylines; G-code files are larger than with native arcs until arc fitting is added. Fine for GRBL at hobby feed rates.
- The adapter layer costs some upfront design but lets us swap in CavalierContours (or similar) later if arc-preserving offsets become important.
- V-carving needs a medial axis / Voronoi computation that Clipper2 does not provide; that will be a separate ADR.
