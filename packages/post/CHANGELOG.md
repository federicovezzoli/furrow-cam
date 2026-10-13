# @furrow/post

## 0.2.1

### Patch Changes

- [#72](https://github.com/federicovezzoli/furrow-cam/pull/72) [`abf54ba`](https://github.com/federicovezzoli/furrow-cam/commit/abf54ba52f541274a4c33631c17ca3e24492382f) Thanks [@federicovezzoli](https://github.com/federicovezzoli)! - Select paths by clicking in the viewport, and cut single paths of a shape ([#54](https://github.com/federicovezzoli/furrow-cam/issues/54), ADR-0018). Operations now reference `targets: [{ shapeId, paths }]` (`paths` the indices of the shape's paths, ascending, or `null` for all of them) instead of `shapeIds`, in project document schema v2; v1 documents migrate to whole-shape targets. Toolpaths are generated from the targeted paths only, so an outline and its holes imported as one element can be profiled and drilled separately. In the top view, clicking a path selects it, Ctrl/Cmd/Shift+click toggles it and clicking outside every path clears the selection; the path under the cursor is highlighted. A path is picked when its line is within 6 pixels of the cursor, or else by being the innermost closed path around it. Selecting a shape in the Geometry pane selects all its paths, and a shape with only some selected shows how many. **Select inside** in the Geometry pane adds every closed path inside the area the selected ones enclose (even-odd, as pockets read it), of any shape, so a pocket's islands are selected in one click. Drill points are picked by the cross they are drawn as. **Add …** and **Use selected** use the selected paths, and the operation's shape list says how many of a shape's paths it cuts. `@furrow/document` adds `normalizeTargets`; `@furrow/cam-core` adds `targetedShapes`, `pickablePaths`, `pathAt`, `pathKey`, `closedPathsInside` and `containmentIn`.
- Updated dependencies [[`6a41b05`](https://github.com/federicovezzoli/furrow-cam/commit/6a41b05ab4404433e91abd63f83095bd7f51d7fd), [`bcfc0e3`](https://github.com/federicovezzoli/furrow-cam/commit/bcfc0e31f382495aeac322f79137adbe1f69f211), [`0d7829b`](https://github.com/federicovezzoli/furrow-cam/commit/0d7829b880820ab9c59ade81e0757428d35ee73d), [`2315823`](https://github.com/federicovezzoli/furrow-cam/commit/23158238f910388fce08bbf046583611ed4ef879), [`abf54ba`](https://github.com/federicovezzoli/furrow-cam/commit/abf54ba52f541274a4c33631c17ca3e24492382f), [`abf54ba`](https://github.com/federicovezzoli/furrow-cam/commit/abf54ba52f541274a4c33631c17ca3e24492382f)]:
  - @furrow/cam-core@0.3.0
  - @furrow/document@0.3.0

## 0.2.0

### Minor Changes

- [#60](https://github.com/federicovezzoli/furrow-cam/pull/60) [`921cb07`](https://github.com/federicovezzoli/furrow-cam/commit/921cb07a6c9de23107e0f5457734e1441fb35e6b) Thanks [@federicovezzoli](https://github.com/federicovezzoli)! - GRBL post-processor and G-code export ([#26](https://github.com/federicovezzoli/furrow-cam/issues/26)). `@furrow/post` defines the `PostProcessor` interface and a registry (`POST_PROCESSORS`) for further dialects, and `exportGcode` turns a project's enabled operations into a GRBL program: millimetres and absolute coordinates measured from the work origin (every stock anchor, custom zeros and both Z zeros), feeds limited per axis to the machine's maximums and spindle speeds kept in its range (both with warnings), `M3` without `S` for manual spindles, the spindle started only after retracting to the safe height, a pause for tool changes between different bits that asks for Z to be zeroed again, and the machine's custom program start, program end, operation start and tool change blocks copied verbatim in place of the defaults, with the modes written again after them. Enabled operations left out for having no toolpath are reported. The workspace's G-code button downloads the program as a `.gcode` file, computed in a Web Worker. `projectFileName` takes an optional extension, and the test fixtures are exported as `@furrow/document/fixtures`.

### Patch Changes

- Updated dependencies [[`bca37a9`](https://github.com/federicovezzoli/furrow-cam/commit/bca37a99f77a889384ad5d3dddc8f2c34bf5b0ba), [`8cb9e68`](https://github.com/federicovezzoli/furrow-cam/commit/8cb9e684948872e7391d6bdc7a8bdaf37805c38f), [`921cb07`](https://github.com/federicovezzoli/furrow-cam/commit/921cb07a6c9de23107e0f5457734e1441fb35e6b), [`99a60af`](https://github.com/federicovezzoli/furrow-cam/commit/99a60af86f8f8226b1f8ba76bea17afb5eb9c49d), [`51e0cd4`](https://github.com/federicovezzoli/furrow-cam/commit/51e0cd4d95c71d9f74ca428a336627cf7ed54919), [`52e3b3a`](https://github.com/federicovezzoli/furrow-cam/commit/52e3b3a411ef391b712c84e394480e4ad17d1aa4), [`a38cae2`](https://github.com/federicovezzoli/furrow-cam/commit/a38cae2ad90e497d267d523e9f474b588d08d9f0), [`ea50706`](https://github.com/federicovezzoli/furrow-cam/commit/ea507062530f1c671e7d798df4c339d6dfed6114), [`a38cae2`](https://github.com/federicovezzoli/furrow-cam/commit/a38cae2ad90e497d267d523e9f474b588d08d9f0), [`4ef3212`](https://github.com/federicovezzoli/furrow-cam/commit/4ef3212b7d2e39e4464c5450a004a94af041548d), [`d3c98e7`](https://github.com/federicovezzoli/furrow-cam/commit/d3c98e7dabf99a1fad1bc592f4050ca9fdf873eb), [`294f207`](https://github.com/federicovezzoli/furrow-cam/commit/294f2074bdb2374344af654ed20d52b74b3ed395), [`6c780c9`](https://github.com/federicovezzoli/furrow-cam/commit/6c780c9a782ecc3c4d79e17e726ddfe3659a1499), [`bbf6532`](https://github.com/federicovezzoli/furrow-cam/commit/bbf6532bc09ba1c6c1d73da613fb598d621b7e4f), [`0b8091c`](https://github.com/federicovezzoli/furrow-cam/commit/0b8091cc4b790b975be145d1376d5087a770538d), [`2f38be9`](https://github.com/federicovezzoli/furrow-cam/commit/2f38be9c783cbb090a052221907fe432b514a7c5), [`1b80f39`](https://github.com/federicovezzoli/furrow-cam/commit/1b80f394baf70e2a915c0f8cae6976943350c5ee)]:
  - @furrow/document@0.2.0
  - @furrow/cam-core@0.2.0

## 0.1.0

### Minor Changes

- [`8a216ca`](https://github.com/federicovezzoli/furrow-cam/commit/8a216ca33f3310d54db1d8236c435f7a870b6e06) Thanks [@federicovezzoli](https://github.com/federicovezzoli)! - Initial monorepo scaffold: Next.js app, project document schema, unit helpers and empty post-processor package.

### Patch Changes

- Updated dependencies [[`8a216ca`](https://github.com/federicovezzoli/furrow-cam/commit/8a216ca33f3310d54db1d8236c435f7a870b6e06)]:
  - @furrow/cam-core@0.1.0
