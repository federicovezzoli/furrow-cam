# ADR-0037: Layer folders in cam-core

- **Status:** Proposed
- **Date:** 2026-10-16
- **Deciders:** Federico Vezzoli
- **Related:** ADR-0007, ADR-0011, ADR-0015, ADR-0021, ADR-0025; issue #132

## Context

ADR-0011 sets the packages and the dependency direction between them, and ADR-0021 the folders inside `apps/web/src`. Nothing set the structure inside a package. `packages/cam-core/src` grew to over 30 modules side by side: geometry helpers, file importers, stock and model placement, viewport helpers, toolpath strategies and the heightmap simulation, with the pocket strategy spread over four files and relief over four more. It was hard to tell where a new module belongs or what may depend on what, and lower-level code had started to depend on higher-level code: rounding shared by `stock.ts` and `translate.ts` lived in the importers' `import-common.ts`, `snap.ts` took `circleCenter` from the drill toolpath and `pick.ts` took `projectOnLoop` from the tabs module.

`@furrow/document` (10 modules) and `@furrow/post` (3) are small enough to stay flat. Consumers import only from `@furrow/cam-core`, whose `exports` is `"."`, so the files inside are free to move.

## Options considered

1. **Keep it flat**, with prefixes (`pocket-*`, `relief-*`): no moves, but prefixes don't show dependencies and the list keeps growing.
2. **Folders by layer**: one folder per level, lower levels never importing higher ones.
3. **Separate packages** per layer: enforceable through `package.json` dependencies, but more workspace and build configuration for code that is always used together.

## Decision

We will group `packages/cam-core/src` into layer folders (option 2):

```
index.ts          the public API, the package's only entry point
units/            unit conversion and quantity formatting
geometry/         clipper (Clipper2 adapter), medial-axis (Delaunator adapter), flatten, bounds,
                  translate, round, loop (projection onto a polyline), circle (circle fitting)
import/           svg/, dxf/, stl/, common (shared by the importers)
scene/            stock, model, snap, pick
simulation/       simulation (heightmap), preview
toolpaths/        toolpath (types), passes, tabs, generate, profile, engrave, drill, vcarve
  pocket/         pocket, cut, linear, peel
  relief/         finish, rough, contours, mesh-raster
```

- `units/` and `geometry/` are the base: they import nothing from the other folders. Pure helpers that other folders need live in `geometry/`, not in the toolpath or importer that first used them.
- The other folders build on the base and may share types with each other: the STL importer returns a scene `Box3`, toolpaths simulate stock for rest machining and the preview draws a `Toolpath`.
- No barrel files inside the folders: `index.ts` is the only one, and it names what the package exports.
- Tests and fixtures stay next to their module.
- The Biome rules that keep Clipper2 and Delaunator behind their adapters (ADR-0015, ADR-0025) now name `geometry/clipper.ts` and `geometry/medial-axis.ts`.

## Consequences

- A new module has an obvious home, and its folder says what it may depend on.
- The layer order is a convention, checked in review. Biome `noRestrictedImports` overrides per folder could enforce it later.
- The paths in ADR-0015 and ADR-0025 (`src/geometry.ts`, `src/medial-axis.ts`) are now `src/geometry/clipper.ts` and `src/geometry/medial-axis.ts`.
