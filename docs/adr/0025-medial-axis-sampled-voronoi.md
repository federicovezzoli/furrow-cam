# ADR-0025: Medial axis from a Voronoi diagram of boundary samples

- **Status:** Proposed
- **Date:** 2026-10-14
- **Deciders:** Federico Vezzoli
- **Related:** PRD-0001 (R16), ADR-0004, ADR-0007, ADR-0015

## Context

V-carving (PRD-0001 R16, issue #97) moves a V-bit along the **medial axis** of each shape: the centres of the largest disks that fit inside it. At each point the depth comes from the disk's radius, the distance to the nearest edge, so the bit cuts up to the edges, reaches into sharp corners and goes deeper where the shape is wider. Clipper2 does not compute a medial axis, and ADR-0007 left the choice to a separate ADR.

Requirements, as for the geometry kernel: it runs in a Web Worker (ADR-0004) on the polylines the importers produce (curves flattened at 0.01 mm, ADR-0007); it must be accurate on text, sharp corners and islands, fast enough for a typical sign, small, and under a licence compatible with the project's MIT licence. The radius must never exceed the true distance to the edges by more than a negligible amount, or the bit cuts past them.

The spike (issue #96) ran a prototype of option 1 in a Node.js `worker_threads` worker on: a 100 × 20 mm rectangle; a letter O (a ring around an island); a C (arcs with square ends); an S (cubic Béziers); an E (convex and reflex 90° corners); a five-pointed star (36° points); and a "sign" of 30 such glyphs, 40 mm tall, ~3,400 input vertices. Accuracy was measured against brute-force distances: how far a radius exceeds the true distance to the edges (a cut too deep), and how far any point of the shape, on a 0.1 mm raster, lies outside every disk on the axis (material left uncarved).

| Spacing | Sign, median | Radius too large by (max) | Left uncarved (worst glyph, the S) |
| --- | --- | --- | --- |
| 0.1 mm | ~160 ms | 6 × 10⁻⁵ mm | none |
| **0.2 mm** | **~64 ms** | 6 × 10⁻⁵ mm | 0.006 % of the area, at most 0.04 mm deep |
| 0.5 mm | ~24 ms | 6 × 10⁻⁵ mm | 0.013 %, at most 0.1 mm deep |

The rectangle's axis is exact (centre line at radius 10, four corner branches to the corners at radius 0), the O gives one closed loop at radius 4 within the flattening tolerance, every convex corner of the E, C and star gets a branch, and no reflex corner does. Delaunator's standalone build, including `robust-predicates`, is 7.9 KB minified, 3.1 KB gzip.

## Options considered

1. **Voronoi of densely sampled boundary points** ([`delaunator`](https://github.com/mapbox/delaunator) 5.1, ISC, the triangulation under `d3-delaunay`): sample every edge, triangulate, keep the circumcentres inside the shape, join neighbouring ones whose two nearest samples lie on different, not nearly parallel, edges. Approximate, but with exact radii (distance to the edges, not to the samples) the error is far below the 0.01 mm chord tolerance. Pure JS, synchronous, tiny, already in the lockfile.
2. **Exact segment Voronoi in WebAssembly from CGAL** ([`voron8`](https://github.com/matthewjacobson/voron8), [`@matthewjacobson/str8`](https://github.com/matthewjacobson/str8) for the straight skeleton): exact, but the CGAL packages they build on (Segment Delaunay Graph, Straight Skeleton) are GPL-3, whatever the npm `license` field says; shipping the WASM to browsers would make the bundled app GPL. `voron8` is also 11.5 MB unpacked and must be loaded asynchronously, like `clipper2-wasm` (ADR-0015). Not benchmarked: the licence ruled them out, and option 1 leaves little accuracy to gain.
3. **Straight skeleton** (CGAL above, or packages such as [`straight-skeleton`](https://github.com/StrandedKitty/straight-skeleton)): its wavefront moves with mitred, not round, corners, so at a reflex corner the "distance" is larger than the true distance and the bit would cut past the corner. Wrong for V-carving whatever the licence.
4. **[`flo-mat`](https://github.com/FlorisSteenkamp/mat)** (MIT, pure TS): computes the medial axis of Bézier curves directly in double-double arithmetic. Precise and licence-compatible, but 7.7 MB unpacked with nine dependencies of the same author, and it works on curves while the CAM core works on flattened polylines. Not benchmarked: option 1 already meets the accuracy and speed requirements.
5. **Boost.Polygon's segment Voronoi built to WebAssembly ourselves**: exact and Boost-licensed, but no maintained JS build exists; we would own an Emscripten toolchain and the same async loading and memory management ADR-0015 avoided.

## Decision

- Use **option 1 on `delaunator`** behind a **`medialAxis`** function in `@furrow/cam-core` (`src/medial-axis.ts`). Only that file imports Delaunator; Biome's `noRestrictedImports` enforces it, as for Clipper2.
- `medialAxis(polygons, { spacing, minAngle, fillRule })` takes millimetre rings (resolved with the fill rule through the geometry adapter, `nonZero` by default) and returns **branches**: runs of points between ends and junctions, each point with its radius. A branch around a ring closes on its first point.
- Boundaries are sampled every **0.2 mm** by default: accurate to hundredths of a millimetre at ~2 ms per glyph.
- Radii are the **exact distance to the edges** the triangle's samples lie on, never the circumradius, so a radius is never larger than the true distance by more than ~10⁻⁴ mm.
- Spurs are pruned by an **angle rule**: an axis edge is kept only when its two nearest samples lie on different edges and subtend at least `minAngle` (30° by default) from it. Corners sharper than 150° keep a branch, which is extended to the corner itself at radius 0; the near-flat vertices of flattened curves get none.

## Consequences

- No WebAssembly, no asynchronous start-up and ~3 KB more in the worker bundle.
- Accuracy and speed are tuned by one parameter, `spacing`; V-carve (#97) can expose it or tie it to the chord tolerance.
- Branches are dense (about one point per sample), so the V-carve toolpath should simplify them, keeping depth within tolerance, before emitting G-code.
- Corners between 150° and 180° lose their branch and leave a sliver of at most a few hundredths of a millimetre; `minAngle` trades that against spurs on curves.
- If an exact algorithm is ever needed, a licence-compatible one can replace the sampling inside the adapter without changing callers; the spike's cases are kept as adapter tests.
