---
"@furrow/web": minor
---

Add a per-user tool library: `Tool` table and migration, server actions to list, create, update and delete tools (validated with the shared `Tool` schema), and a `/tools` page to manage them. New accounts start with a 6 mm 2-flute upcut flat end mill. Operations will store a snapshot of the tool, so editing the library never changes existing projects.
