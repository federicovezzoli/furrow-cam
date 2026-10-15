# ADR-0028: Named project versions stored as full documents

- **Status:** Proposed
- **Date:** 2026-10-15
- **Deciders:** Federico Vezzoli
- **Related:** PRD-0001 (R13c), ADR-0003, ADR-0010

## Context

A project has one document (`Project.document`, ADR-0003) that autosave keeps overwriting. The only history is the in-memory undo stack (ADR-0010), which is lost when the tab closes. Users want to save a named version of a project when they are happy with it and go back to it later (#37).

## Options considered

1. **Full copies in a `ProjectVersion` table**: each version is a complete document with its own `schemaVersion`. Pros: every version is self-contained and is upgraded and validated like the live document or an exported file; restore is a copy. Cons: storage grows with document size times version count.
2. **Diffs (e.g. JSON patches) against the live document**: smaller, but a version depends on every later patch, schema migrations would have to rewrite the patches, and a corrupt link breaks every older version.
3. **Versions inside `Project.document`**: no new table, but every autosave would rewrite all versions, and the document format (also the export format) would carry history.

## Decision

We will use option 1 and extend ADR-0003 (it is not superseded):

- A `ProjectVersion` row holds `projectId` (cascade-deleted with its project), an optional `label`, `schemaVersion`, the `document` (`jsonb`) and `createdAt`. Toolpaths stay derived and are never stored.
- Creating a version copies the **stored** document on the server, never one sent by the client; the client flushes pending autosave first.
- Restoring upgrades the version with `parseProjectDocument`, saves the live document as an automatic version ("Before restoring …") and replaces it, in one transaction guarded by the same `updatedAt` check as autosave. Versions saved by a newer release, or invalid ones, can't be restored. A restore isn't an undo step: the client reloads its document store and clears undo/redo.
- A project keeps at most 50 versions, automatic ones included. Past the cap, saving and restoring fail with an error; nothing is pruned silently.

## Consequences

- Storage per project grows with the number of versions; the cap bounds it.
- Versions are read like any stored document, so schema migrations need no extra work for them.
- Ownership is checked through the project (`project.userId`); versions add no personal data (ADR-0013).
