# ADR-0003: Server-side persistence with Prisma and PostgreSQL

- **Status:** Accepted
- **Date:** 2026-10-08
- **Deciders:** Federico Vezzoli
- **Related:** PRD-0001, ADR-0002, ADR-0005, ADR-0006

## Context

Users need their projects, tool (bit) library, machine profiles and post-processor settings available across devices and sessions. This requires server-side storage and user accounts from the first release.

The data has two very different shapes:

- **Stable, queryable entities**: users, machines, tools, project metadata (name, owner, timestamps). These benefit from a relational schema, constraints and migrations.
- **Project contents**: imported geometry, stock definition, operations and their parameters. This is large, nested, always loaded and saved as a whole, and its shape will evolve rapidly during early development.

## Options considered

1. **Fully normalized relational model** for everything, including geometry and operations. Pros: maximal integrity. Cons: a migration for every change to operation parameters, expensive to load/save, awkward mapping of nested geometry.
2. **Hybrid: relational entities + versioned JSON document per project** (PostgreSQL `jsonb`). Pros: stable parts get relational guarantees; project content evolves via schema versioning in application code; one row read/write per project; doubles as export/import file format. Cons: integrity of project contents is enforced in application code, not the DB.
3. **Document database (e.g. MongoDB)**. Cons: loses relational guarantees for users/tools/machines; Prisma support is weaker.

## Decision

We will use **Prisma ORM** with **PostgreSQL**, following the **hybrid model** (option 2):

- Relational tables for `User`, `Machine`, `Tool`, `PostProcessorConfig`, `Project` (metadata) and related entities.
- `Project.document` is a `jsonb` column containing the project contents, with an explicit `schemaVersion` field.
- The project document schema is defined once in TypeScript (e.g. with Zod) and shared by client and server. The server validates every write against it.
- Document schema upgrades are handled by versioned migration functions in application code (`v1 → v2 → …`), applied on load.
- The same document format is used for project file export/import.
- Tool and machine settings referenced by a project are **copied (snapshotted) into the document** when used, so editing the tool library later does not silently change existing toolpaths.

## Consequences

- PostgreSQL becomes a hard dependency; hosting is covered in ADR-0005. A `docker-compose` setup should be provided for local development.
- User authentication is required; see ADR-0006.
- Offline use is not supported in the MVP; the browser needs the server to load and save.
- Project document validation and migrations need thorough tests, since the DB will not enforce their structure.
