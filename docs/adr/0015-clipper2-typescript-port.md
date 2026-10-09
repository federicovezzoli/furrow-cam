# ADR-0015: Clipper2 TypeScript port (clipper2-ts)

- **Status:** Accepted
- **Date:** 2026-10-09
- **Deciders:** Federico Vezzoli
- **Related:** PRD-0001 (R5–R8, performance), ADR-0004, ADR-0007

## Context

ADR-0007 chose Clipper2 as the polygon kernel and left the package to a spike (issue #18). The kernel runs in Web Workers (ADR-0004), behind the `geometry` adapter in `@furrow/cam-core`, at a fixed scale of 1 unit = 0.0001 mm.

The spike ran the same cases through each candidate in a Node.js `worker_threads` worker (the V8 engine of a browser worker), with curves flattened at the default 0.01 mm chord tolerance:

- **Correctness:** inward offset of a square with a hole; a self-touching ring (two squares sharing a corner) offset both ways and unioned; a self-intersecting bow tie; a dumbbell that must split at its neck; circles unioned then cut by an island; point containment inside, outside and on the boundary.
- **Speed:** every pocket ring (3 mm step-over) of a 300 × 300 mm region with 60 circular islands (206 rings, ~34,000 points), and a union of 2,000 overlapping circles. Median of repeated runs after a warm-up.
- **Bundle size:** esbuild, minified, the functions the adapter uses.

| Package | Correctness | Pocket rings | Union 2,000 circles | Bundle (gzip) |
| --- | --- | --- | --- | --- |
| [`clipper2-ts`](https://github.com/countertype/clipper2-ts) 2.0.1-18 (TypeScript port, maintained) | identical to the WASM build on every case | ~50 ms | ~55 ms | 18 KB |
| [`clipper2-wasm`](https://github.com/ErikSom/Clipper2-WASM) 0.4.0 (Emscripten build of the C++ library) | reference | ~30 ms | ~48 ms | 10 KB JS + 82 KB `.wasm` |
| [`clipper2-js`](https://github.com/IRobot1/clipper2-ts) 1.2.4 (older port, unmaintained since 2024) | offset areas off by up to 12 %, a spurious extra ring, never finished the pocket workload | — | — | — |

Other observations:

- `clipper2-wasm` must be loaded asynchronously, ships a `.wasm` asset the bundler has to serve to workers, takes `BigInt` coordinates as flat `[x, y, z]` triples, and every path object must be freed with `.delete()` or it leaks worker memory.
- `clipper2-ts` is synchronous, uses plain `{ x, y }` objects with `number` coordinates (exact up to 2⁵³ units, i.e. ~900 km at our scale), has no DOM or global access, and is marked side-effect free.
- In every library, offsetting an already-offset ring adds join vertices at each pass: chaining 3 mm offsets grew 15,000 points to 155,000 in four rings and stalled. Rings must be offset from the source region with a growing delta.

## Options considered

1. **`clipper2-ts`**: same results as the C++ library, about 1.5× slower in absolute terms of tens of milliseconds, smallest bundle, no asset or memory management. Published only as prerelease versions (`2.0.1-N`) under the `latest` tag.
2. **`clipper2-wasm`**: fastest, but the async loading, `.wasm` asset, `BigInt` marshalling and manual memory management all leak into the adapter and the worker setup, for a gain that is small next to the PRD's 2 s budget.
3. **`clipper2-js`**: rejected; wrong results.

## Decision

- Use **`clipper2-ts`** as the Clipper2 package, pinned to an exact version because its releases are prereleases.
- Only `packages/cam-core/src/geometry.ts` imports it. The adapter exposes `offset`, `union`, `difference`, `intersection`, `nest` (outer boundaries with their holes), `containment` and `signedArea` on millimetre `[x, y]` rings; outer boundaries wind counter-clockwise and holes clockwise.
- Round-join arc tolerance defaults to the chord tolerance (0.01 mm), so offsets and flattened curves have the same accuracy.
- Toolpath code computes successive rings by offsetting the source region, never by re-offsetting a ring.

## Consequences

- No asynchronous kernel start-up and no `.wasm` asset in the Next.js and worker build.
- If profiling later shows the kernel is the bottleneck, `clipper2-wasm` can replace it inside the adapter without touching callers; the spike's cases are kept as adapter tests to check a swap.
- Upgrades of `clipper2-ts` are deliberate (exact pin) and must pass the adapter tests.
