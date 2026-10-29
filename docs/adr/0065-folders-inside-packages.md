# ADR-0065: Folders inside packages

- **Status:** Proposed
- **Date:** 2026-10-29
- **Deciders:** Federico Vezzoli
- **Related:** ADR-0011, ADR-0037; #398, #399, #400. Supersedes in part ADR-0037: `@furrow/document` and `@furrow/post` no longer stay flat.

## Context

ADR-0037 grouped `packages/cam-core/src` into layer folders and kept the two other core packages flat: "`@furrow/document` (10 modules) and `@furrow/post` (3) are small enough to stay flat." Both have grown since. `packages/document/src` held 14 modules side by side (about 5.7k lines with tests): the schema, tool and machine presets, migrations and project archives. `packages/post/src` holds the G-code writer, export, touch-off and setup notes, and #398 / #399 gave the GRBL post-processor its own `grbl/` folder, which that sentence did not allow.

The repo is open source: contributors should see from the folders where a module belongs and what it may import. The document modules already formed layers without cycles:

```
units → geometry → model, font, tool, machine → operation → document → migrations → archive
message, file: no dependencies      tool-presets → tool      machine-presets → machine
```

## Options considered

1. **Keep `document` and `post` flat**: no moves, but the list keeps growing and `post/src/grbl/` stays an exception to a written rule.
2. **Folders by layer or by implementation**, as in `cam-core`, for any package that outgrows a flat list.

## Decision

We will group a package's modules into folders once a flat list stops showing where things belong (option 2). This is the general rule for every package, not only `cam-core`:

- Folders group modules by **layer** (lower folders never import higher ones) or by **implementation** (one folder per dialect or adapter, such as `post/src/grbl/`).
- `index.ts` is the only barrel and the package's public API. Folders have no `index.ts`.
- Tests and fixtures stay next to their module.
- Moving files does not change a package's `exports` or what it exports.

`packages/document/src` becomes:

```
index.ts, fixtures.ts   entry points (fixtures is the ./fixtures subpath export)
schema/                 units, geometry, model, font, tool, machine, operation, document, message
presets/                tool-presets, machine-presets
storage/                migrations, archive, file
```

`presets/` and `storage/` may import from `schema/`; `schema/` imports from neither. `migrations.ts` stays one file: its short functions read best together.

`packages/post/src` keeps the shared, dialect-agnostic modules at the top level and puts each post-processor dialect in its own folder (`grbl/`). `e2e/` holds end-to-end tests, not a dialect.

## Consequences

- A new document module has an obvious home: a Zod type goes in `schema/`, a preset in `presets/`, anything that reads or writes a document in `storage/`.
- New post-processor dialects get their own folder beside `grbl/` instead of more files at the top level.
- A Biome `noRestrictedImports` override on `packages/document/src/schema/**` enforces that `schema/` imports neither `storage/` nor `presets/`. The `cam-core` layers (ADR-0037) remain a convention checked in review.
