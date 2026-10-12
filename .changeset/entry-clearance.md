---
"@furrow/document": minor
"@furrow/cam-core": minor
"@furrow/web": minor
---

Entry clearance in machine profiles. Machines have an `entryClearance`: the height above the stock top where rapids down stop and feeding starts, from 0 up to `safeZ`, 1 mm by default. Existing machines are backfilled with 1 mm, and the document schema moves to version 3, with a migration that gives machine snapshots 1 mm too, so existing toolpaths don't change. The machine form has an "Entry clearance (above stock)" field and the machines table a column for it. In `@furrow/cam-core`, `ToolpathInput` and the profile, pocket and drill options take `entryClearance`, from the project's machine or `DEFAULT_ENTRY_CLEARANCE` (1 mm) without one. `ENTRY_CLEARANCE` is removed.
