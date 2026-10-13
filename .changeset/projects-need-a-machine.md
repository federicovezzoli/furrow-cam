---
"@furrow/web": minor
---

Projects are now created for a machine: its profile is snapshotted into the project, so G-code export uses its post-processor, limits and custom blocks. Creating or importing a project needs a machine (with several, one is chosen); the project list and workspace show each project's machine, the workspace properties can change it (undoable), and projects without one can't export G-code until it is set.
