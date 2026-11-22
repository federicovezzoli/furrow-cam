# ADR-0092: Layer folders in post

- **Status:** Accepted
- **Date:** 2026-11-22
- **Deciders:** Federico Vezzoli
- **Related:** ADR-0037, ADR-0065, ADR-0091; #400, #578, #656. Supersedes in part ADR-0065 (the `post` paragraph) and ADR-0091 ("the shared helpers stay where they are").

## Context

ADR-0065 kept the dialect-agnostic modules of `packages/post/src` at the top level, with one folder per dialect beside them, and ADR-0091 kept them there when Marlin became the second dialect. That left 14 modules side by side: the contract types, the program writer and its helpers, the read-back, machine limits and the estimate, and the export registry. `document` had as many when ADR-0065 gave it folders.

More dialects are planned (grblHAL, FluidNC, LinuxCNC). ADR-0091 says a dialect that replaces most of the program gets its own writer reusing the shared helpers, so contributors need to see which modules those helpers are and what each may import.

The imports already formed layers but for one cycle: `post.ts` imported the `Dialect` type from `program.ts`, which imports from `post.ts`.

## Decision

`packages/post/src` becomes:

```
index.ts             public API
post.ts, format.ts   the contract (PostInput, PostProcessor, PostWarning, GcodeExportError, Dialect) and number formatting
machine/             machine-limits, estimate
read-back/           read-back, travel
program/             program, gcode-writer, tool, setup-notes, touch-off
grbl/, marlin/       one Dialect each (ADR-0091)
export.ts            POST_PROCESSORS, exportGcode, file names
e2e/                 corpus and checker (tests, not a layer)
```

Layers, lowest first: `post.ts` and `format.ts`, then `machine/` and `read-back/` (one layer: neither needs the other), `program/`, the dialect folders, and `export.ts`. A module imports only from its own layer or lower ones. `Dialect` moves into `post.ts`, so the contract imports nothing else in the package.

A Biome `noRestrictedImports` override on `post.ts`, `format.ts`, `machine/**` and `read-back/**` keeps them from importing `program/`, a dialect folder, `export` or `index` (also written as `.` or `..`), and the contract from importing any folder. The rest stays a convention checked in review, as in `cam-core` (ADR-0037).

A new dialect is still a folder beside `grbl/` (ADR-0091). A dialect with its own program writer keeps that writer in its folder and imports the helpers it reuses from `program/`.

## Consequences

- `@furrow/post` exports the same names; nothing outside the package changes, and the corpus programs are unchanged byte for byte.
- `e2e/` keeps its paths, which the MCP server's tests read.
- `export-test-utils.ts` stays beside `export.ts`, the module it tests.
