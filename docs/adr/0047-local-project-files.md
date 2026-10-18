# ADR-0047: Desktop projects are `.furrow` archives that carry their versions

- **Status:** Proposed
- **Date:** 2026-10-18
- **Deciders:** Federico Vezzoli
- **Related:** PRD-0007, PRD-0005, ADR-0003, ADR-0010, ADR-0028, ADR-0029, ADR-0044, ADR-0045; #184

## Context

In the desktop app (ADR-0044), projects are files on the user's disk. The web app already exports two formats: `.furrow.json` (the document) and, for projects with 3D models, `.furrow.zip` (the document at `project.furrow.json` and each mesh at `meshes/<sha256>.stl`, ADR-0029). `readProjectArchive` ignores files it doesn't know.

On the web, autosave writes every change to the server (ADR-0003), and named versions are full document copies in a table, at most 50 per project (ADR-0028). Users of desktop applications expect explicit saving, and PRD-0007 keeps versions in the desktop app.

## Options considered

**Format**

1. **A new format.** Freedom to design, but files wouldn't move between the web and desktop apps without conversion.
2. **The `.furrow.zip` archive under a new extension, `.furrow`**, extended with versions. Same reader in both apps; the extension can be associated with the app so a double click opens it.

**Versions**

1. **Leave them out** of the desktop app; Save As covers it.
2. **Snapshots inside the file**, as ADR-0028's full copies.
3. **A sidecar folder** next to the file. Breaks when the file is moved or sent alone.

**Saving**

1. **Autosave to the user's file.** Matches the web app, but a mistake can't be abandoned by closing without saving.
2. **Explicit Save,** with a crash-recovery copy written in the background.

## Decision

We will use option 2 for format and versions, and explicit saving.

- **Extension and layout.** A desktop project is a `.furrow` file: a zip with `project.furrow.json` and `meshes/<sha256>.stl`, as `.furrow.zip`, plus `versions/<id>.json` for each saved version. A version file holds `{ id, label, createdAt, automatic, document }`, where `document` is a full `ProjectDocument` with its own `schemaVersion` (ADR-0028). The archive holds every mesh referenced by the document or by any version.
- **Limits.** Each document in the file, live or version, obeys the existing limits: at most 4 MB of JSON, at most four meshes, each mesh within the STL limits (PRD-0005 S1). At most 50 versions (ADR-0028). So a `.furrow` file always opens in the web app.
- **Compatibility.** The desktop app opens `.furrow`, `.furrow.zip` and `.furrow.json` and saves `.furrow`. The web app's import accepts `.furrow` and, for now, ignores its versions; its Export is unchanged.
- **Saving.** New, Open, Save, Save As and Close, with the window showing when there are unsaved changes and asking before closing or quitting with them. Save writes to a temporary file in the same folder and renames it over the original, so a failed save never leaves a half-written project.
- **Crash recovery.** On the existing autosave timer, the app writes the open project to a recovery copy in its data folder, keyed by the file's path (or an id for unsaved projects). Save and Close without saving delete it. At start-up, a leftover recovery copy is offered for restoring.
- **Versions.** Creating, renaming, deleting and restoring a version changes the project in memory and marks it modified, like any edit; it reaches the disk on Save. Restoring follows ADR-0028: it first keeps the current document as an automatic version, and isn't an undo step.
- **Library.** The tool library and machine list are `tools.json` and `machines.json` in the app's data folder, validated with the document package's tool and machine schemas. Projects keep their snapshots (ADR-0003), so a project opens on another computer without the library.

## Consequences

- One reader and one writer serve the web export, the web import and the desktop app; `@furrow/document` gains version entries in the archive.
- Versions travel with the file. A file with many versions of a large project grows accordingly; the 50-version cap bounds it.
- Importing a `.furrow` with versions into the web app drops the versions. Carrying them into `ProjectVersion` rows is possible later without changing the format.
- Users can lose unsaved work only if both the app and the recovery copy are lost.
