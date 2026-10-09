---
"@furrow/document": minor
"@furrow/web": minor
---

Add machine profiles: `Machine` table and migrations, server actions to list, create, update and delete the signed-in user's machines (validated with the shared `Machine` schema), and a `/machines` page with a create/edit form. A machine has a work area, maximum feeds, a safe Z, a post-processor (GRBL) and a spindle speed range, or none for a manual spindle. It can also hold custom G-code for the program start, program end, operation start and tool change; a filled-in block replaces the post-processor's default at that point, copied verbatim. Projects will store a snapshot of their machine, so editing or deleting a machine never changes existing projects.
