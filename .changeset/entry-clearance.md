---
"@furrow/document": minor
"@furrow/cam-core": minor
"@furrow/web": minor
---

Entry clearance in machine profiles. Machines have an `entryClearance`: the height above the stock top where rapids down stop and feeding starts, from 0 up to `safeZ`, 1 mm by default (`DEFAULT_ENTRY_CLEARANCE` in `@furrow/document`). Existing machines and, through a document schema v3 migration, machine snapshots keep what toolpaths used before: 1 mm, capped at their safe Z. The machine form has an "Entry clearance (above stock)" field and the machines table a column for it. In `@furrow/cam-core`, `ToolpathInput` and the profile, pocket and drill options take `entryClearance`, from the project's machine or the default without one; `ToolpathBuilder` takes it next to `safeZ` and caps it there. Only rapids down use it: pockets on their first pass and bores between rings now cross uncut stock at the retract height instead of just above it. `ENTRY_CLEARANCE` is removed.
