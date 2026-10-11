---
"@furrow/web": minor
---

Add projects: `Project` table and migration (metadata columns plus the project document as `jsonb`, with a copy of its `schemaVersion`), server actions to list, create, rename, delete, load and save the signed-in user's projects (every save is validated with `ProjectDocument`, and loading upgrades older documents), and a `/projects` page to create, rename and delete them. Opening a project shows a placeholder workspace for now. The sign-out button moves to the header.
