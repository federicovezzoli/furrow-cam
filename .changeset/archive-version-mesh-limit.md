---
"@furrow/web": patch
"@furrow/document": patch
---

Importing a `.furrow` file no longer fails when only one of its saved versions uses a model larger than the server's STL size limit; models the project itself uses are still held to that limit.
