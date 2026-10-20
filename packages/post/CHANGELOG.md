# @furrow/post

## 0.8.0

### Minor Changes

- G-code now waits for the spindle to reach speed (`G4`) after starting it or raising its speed, before the bit moves. Machine profiles have a spin-up delay, 5 seconds by default, for existing machines and projects too; a manual spindle, switched on by hand, gets no wait. ([#264](https://github.com/federicovezzoli/furrow-cam/pull/264))

### Patch Changes

- Profiles, pockets and 3D roughing and finishing no longer take drill bits, which snap when moved sideways through the stock: the tool picker disables them, and new operations start with a bit that cuts sideways. A project saved with a drill bit on one of these operations still opens; the operation shows why it has no toolpath until you pick another bit, and G-code export refuses the project rather than leaving that operation out. ([#262](https://github.com/federicovezzoli/furrow-cam/pull/262))
- G-code now sets millimetres and absolute coordinates again after each tool-change pause, so a probe macro or jog that leaves G91 or G20 behind can't make the next moves relative or in inches. ([#263](https://github.com/federicovezzoli/furrow-cam/pull/263))
- Updated dependencies: @furrow/document@0.9.0, @furrow/cam-core@0.8.4

## 0.7.3

### Patch Changes

- Updated dependencies: @furrow/cam-core@0.8.3

## 0.7.2

### Patch Changes

- Updated dependencies: @furrow/document@0.8.0, @furrow/cam-core@0.8.2

## 0.7.1

### Patch Changes

- Updated dependencies: @furrow/document@0.7.1, @furrow/cam-core@0.8.1

## 0.7.0

### Minor Changes

- Importing a file no longer adds a touch-off pad: tick **Touch-off pad** in the zero settings, and it is placed on the XY zero. The pad can have its own tool-change G-code, suggested from the machine's with its move put on the pad, and the viewport marks it with a dashed ring and a "Z touch-off" label instead of a disc that looked like the bit. ([#182](https://github.com/federicovezzoli/furrow-cam/pull/182))

### Patch Changes

- Updated dependencies: @furrow/document@0.7.0, @furrow/cam-core@0.8.0

## 0.6.0

### Minor Changes

- Exported GRBL programs now describe each tool's cutter shape in a `(Furrow tool: …)` comment where the bit is in the spindle, so the G-code simulation can read it back. GRBL ignores comments, so the machine runs the program as before. ([#171](https://github.com/federicovezzoli/furrow-cam/pull/171))

### Patch Changes

- Updated dependencies: @furrow/cam-core@0.7.0

## 0.5.0

### Minor Changes

- Exporting G-code reuses the toolpaths the workspace has already computed instead of computing every one again, so a project with 3D operations exports at once. ([#158](https://github.com/federicovezzoli/furrow-cam/pull/158))
- Projects zeroed on the stock top get a touch-off pad: a spot of the stock top that 3D operations never cut and 2D operations warn about, where the machine stops at each tool change so Z can be zeroed again. Its position and size are set with the zero point. ([#157](https://github.com/federicovezzoli/furrow-cam/pull/157))

### Patch Changes

- Updated dependencies: @furrow/cam-core@0.6.0, @furrow/document@0.6.0

## 0.4.0

### Minor Changes

- Finish STL models with 3D parallel passes at any angle, with step-over, one-way or zig-zag direction and stock to leave, then preview, simulate and export them to G-code like other operations. Long toolpaths show their progress and can be cancelled. ([#129](https://github.com/federicovezzoli/furrow-cam/pull/129))
- 3D roughing and finishing can now cut only the material the operations before them left, so a smaller bit only works where a larger one couldn't reach, without cutting air. ([#136](https://github.com/federicovezzoli/furrow-cam/pull/136))

### Patch Changes

- Updated dependencies: @furrow/document@0.5.0, @furrow/cam-core@0.5.0

## 0.3.0

### Minor Changes

- [#108](https://github.com/federicovezzoli/furrow-cam/pull/108) [`c37461f`](https://github.com/federicovezzoli/furrow-cam/commit/c37461f8e309bebc17b358d464d260eaa35b933e) Thanks [@federicovezzoli](https://github.com/federicovezzoli)! - Add a V-carve operation (PRD-0001 R16): a V-bit follows the medial axis of the selected closed paths, as deep at each point as its angle and tip need to reach the nearest edge, so corners are carved right into and wider parts go deeper. Islands, such as the middle of an O, stay standing. It goes no deeper than the operation's maximum depth or the bit's cone, in passes no deeper than the bit's step-down, and feeds back along the groove it already cut between passes instead of retracting. Without a flat bottom, parts wider than the bit reaches at the maximum depth are carved along the axis only, with a warning. With one, a flat end mill clears them flat at that depth first, and the V-bit then carves their walls. The G-code cuts the two as separate steps with a tool change between them (ADR-0026). The preview shades V-carve toolpaths darker the deeper they go and draws the clearing moves in the end mill's colour, and the simulation cuts them with the end mill. The simulation's grid now has six cells across the narrowest groove rather than the smallest tool: a V-bit's groove a quarter of the way down its deepest cut, a ball end mill's chord at its depth. Each move only sweeps as far as the tool reaches below the stock top, so V-carves and shallow V-bit engravings show their shape instead of a few coarse cells. New V-carves go as deep as the bit's cone, but no deeper than half the stock. Documents move to schema version 6 with no changes to existing data.
  
  `@furrow/document` adds `VCarveParams`, `VCarveOperation`, `canVCarve`, `canClearFlatBottom` and `clearingTool`. `@furrow/cam-core` adds `vcarveToolpath` and `clearPocket` (a pocket of polygons), an optional `clearing` move list on `Toolpath`, and `feedColors` on `ToolpathLines` (`shadeDepth` option); `smallestDiameter` is replaced by `smallestCutWidth`. `medialAxis` no longer returns the specks that graded sampling grows at each step of a drawn edge (rounded coordinates, dense polylines), which V-carving cut as hundreds of separate runs, each with a plunge and a retract; a tiny piece within 0.01 mm of the rest of the axis, such as the tip of a very sharp corner, is joined to it instead. `@furrow/post` adds `postSteps`, which splits each operation into one step per tool.

### Patch Changes

- Updated dependencies [[`cc7ae78`](https://github.com/federicovezzoli/furrow-cam/commit/cc7ae785bdfd27dc7a20fba74779275fedd4999b), [`eb7b875`](https://github.com/federicovezzoli/furrow-cam/commit/eb7b875b9b01c5ee60da1b1795a130513acb3a11), [`d94bb85`](https://github.com/federicovezzoli/furrow-cam/commit/d94bb8589fcf968d9171ede3c540de3c678c4e51), [`f328969`](https://github.com/federicovezzoli/furrow-cam/commit/f32896993f837f894efa8b8aee9b4d9bec1d2f4f), [`c37461f`](https://github.com/federicovezzoli/furrow-cam/commit/c37461f8e309bebc17b358d464d260eaa35b933e)]:
  - @furrow/cam-core@0.4.0
  - @furrow/document@0.4.0

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
