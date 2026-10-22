# ADR-0058: Each operation sets its own step-over; tools have none

- **Status:** Proposed
- **Date:** 2026-10-22
- **Deciders:** Federico Vezzoli
- **Related:** PRD-0001 (R7, R18, R20), PRD-0005 (S4, S5), ADR-0003, ADR-0026, ADR-0033; #332. Supersedes ADR-0033's rule that roughing's step-over is the tool's unless the operation sets its own.

## Context

The step-over was a field of the tool (`Tool.stepOver`), snapshotted into each operation with the rest of the tool (ADR-0003). Pockets, boring with an end mill and V-carve flat bottoms (ADR-0026) could only use it; 3D roughing could override it (ADR-0033) and 3D finishing always had its own.

The step-over depends on the job more than on the bit: with the same end mill a roughing pocket may run at 50% and a clean-up or a peel at 15%, and one project often needs both. Editing a library bit re-snapshots it into every operation that uses it, so two pockets with the same bit couldn't have different step-overs.

## Options considered

1. **Keep `Tool.stepOver` as the default for new operations**, each operation storing its own. No database change, but two values with the same name, and the tool's one no longer does what users expect from it.
2. **Move it to the operation and remove it from the tool**, new operations starting from a fixed default per type. One value, where it applies; needs a database migration and a document migration.

## Decision

- We will use **option 2**. `Tool` has no step-over. `PocketParams`, `DrillParams` (used when an end mill bores a hole), V-carve's `flatBottom` and `ReliefRoughParams` have a required `stepOver`, a percentage of the tool's diameter, like `ReliefFinishParams` already did.
- New pockets, drill operations, flat bottoms and 3D roughing start at 40%, 3D finishing at 10%. Changing an operation's tool, or editing the bit in the library, leaves its step-over alone.
- Schema version 18 moves each snapshot's step-over into the operation that used it (3D roughing keeps its own when it had one), so existing projects cut as before. A Prisma migration drops the `tool.stepOver` column. Desktop tool libraries need no migration: `Tool` strips the stale key when it reads them.

## Consequences

- The Properties pane has a step-over field for every operation that clears an area; the tool form and the tool list don't.
- A bit's preferred step-over is no longer remembered: each new operation starts from the default.
- Step-down still comes from the tool. If it ever needs to vary per operation, it can follow the same pattern.
