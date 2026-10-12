---
"@furrow/document": minor
"@furrow/cam-core": minor
"@furrow/post": patch
"@furrow/web": minor
---

Select paths by clicking in the viewport, and cut single paths of a shape (#54, ADR-0018). Operations now reference `targets: [{ shapeId, paths }]` (`paths` the indices of the shape's paths, ascending, or `null` for all of them) instead of `shapeIds`, in project document schema v2; v1 documents migrate to whole-shape targets. Toolpaths are generated from the targeted paths only, so an outline and its holes imported as one element can be profiled and drilled separately. In the top view, clicking a path selects it, Ctrl/Cmd/Shift+click toggles it and clicking outside every path clears the selection; the path under the cursor is highlighted. A path is picked when its line is within 6 pixels of the cursor, or else by being the innermost closed path around it. Selecting a shape in the Geometry pane selects all its paths, and a shape with only some selected shows how many. **Select inside** in the Geometry pane adds every closed path inside the selected ones, of any shape, so a pocket's islands are selected in one click. **Add …** and **Use selected** use the selected paths, and the operation's shape list says how many of a shape's paths it cuts. `@furrow/cam-core` adds `targetedShapes`, `pickablePaths`, `pathAt`, `closedPathsInside` and `containmentIn`.
