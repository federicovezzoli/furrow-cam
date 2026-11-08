# ADR-0079: A project's machine snapshot links to the library machine it came from

- **Status:** Proposed
- **Date:** 2026-11-08
- **Deciders:** Federico Vezzoli
- **Related:** ADR-0003, ADR-0045, ADR-0067, PRD-0001 (R19), #512

## Context

Projects keep a snapshot of their machine profile (ADR-0003), so editing a machine in the library never silently changes a project's G-code. The snapshot didn't record where it came from: the workspace found its library machine by comparing every field, so once that machine was edited it couldn't tell "edited" from "deleted" or "never in this library". Projects kept outdated settings (safe Z, feeds, custom G-code) without telling the user.

## Options considered

1. **Keep matching by value.** Nothing to store, but an edited machine can never be found again.
2. **Store the library machine's id next to the snapshot**, in the document, and match by name when there is none. The snapshot stays what G-code is made from.
3. **Reference the library machine instead of snapshotting it.** Breaks ADR-0003's guarantee that existing projects' G-code never changes on its own.

## Decision

We will use option 2:

- The project document gains `machineId: string | null` beside `machine` (schema version 35; older documents migrate to `null`). It is not part of the `Machine` schema, which also validates library rows.
- Choosing a machine, in the workspace, when creating a project or through the MCP server, stores its id with the snapshot.
- A snapshot's source is the library machine with that id or, without an id (older projects, imported files), the only library machine with the same name.
- When a project opens and its source differs from the snapshot, the workspace offers to update the snapshot, listing the changed fields. It doesn't when another library machine still has the snapshot's values, which the machine select then shows. Updating is one undoable edit; keeping the copy changes nothing, and the same change isn't offered again in that session, whichever project or file it is opened from. A missing source (deleted, another account's id) asks nothing. A link under the machine select offers the same update later.
- `machine` remains the only input to toolpaths and G-code; the id only finds the source.

## Consequences

- Users learn when a project uses outdated machine settings and update it in one click, while ADR-0003's guarantee holds: nothing changes without their choice.
- A dismissed offer comes back the next session; nothing about it is stored.
- Ids are meaningless across accounts or installs, so a shared project falls back to no prompt rather than a wrong one; only id-less snapshots use the name.
- Tools have the same gap (their "as picked" snapshots); they can follow this pattern later.
