---
"@furrow/document": minor
"@furrow/web": minor
---

Export and import projects as files. Each row on `/projects` has an export button that downloads the project document, upgraded to the current schema version, as `<name>.furrow.json`; "Import file…" creates a new project from such a file, named after it. Imported files are upgraded and validated with `parseProjectDocument`, with clear errors for files that aren't projects, aren't valid or were saved by a newer version (also shown when opening such a stored project). `@furrow/document` adds `PROJECT_FILE_EXTENSION`, `projectFileName`, `projectNameFromFileName` and `ProjectDocumentTooNewError`, now thrown by `migrateProjectDocument` for documents from a newer release.
