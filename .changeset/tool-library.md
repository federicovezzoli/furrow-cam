---
"@furrow/web": minor
---

Add a per-user tool library: `Tool` table and migrations, server actions to list, create, update and delete tools and pick the default one (validated with the shared `Tool` schema), and a `/tools` page to manage them. Each tool has a colour, and one tool can be the default. New accounts start with a 6 mm 2-flute upcut flat end mill as their default. Operations will store a snapshot of the tool, so editing the library never changes existing projects.
