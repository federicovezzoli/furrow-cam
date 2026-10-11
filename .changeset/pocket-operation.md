---
"@furrow/document": minor
"@furrow/cam-core": minor
"@furrow/web": minor
---

Pocket operation: clears the area inside closed paths with concentric offsets at the tool's step-over and step-down, from the centre out, leaving islands (nested paths) standing, with extra rings when the step-over is over half the diameter. `PocketParams` holds the direction (climb or conventional), depth, wall allowance, an optional full-depth finish pass on the walls and islands, and ramp entry along the ring at the tool's plunge angle. Between rings and depth passes the tool stays down inside the cleared pocket, and only retracts to the safe height when it leaves one. In the workspace, "Add pocket" creates one from the selected shapes and the Properties panel edits its params. `@furrow/cam-core` adds `pocketToolpath`.
