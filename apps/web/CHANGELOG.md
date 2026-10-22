# @furrow/web

## 0.17.0

### Minor Changes

- Errors, confirmations and renames now open in an in-app dialog that matches the theme, instead of the browser's own alert, confirm and prompt boxes. ([#338](https://github.com/federicovezzoli/furrow-cam/pull/338))
- The step-over is now set on each pocket, drill, V-carve flat bottom and 3D roughing operation instead of on the bit, so operations with the same bit can use different step-overs. Existing projects keep the step-over their bits had. ([#335](https://github.com/federicovezzoli/furrow-cam/pull/335))

### Patch Changes

- Error messages from saving, importing and managing projects, tools, machines and 3D models are now shown in the language the page is displayed in. ([#331](https://github.com/federicovezzoli/furrow-cam/pull/331))
- Saving changes to a machine now keeps you on its page with a confirmation, and open projects pick up the new settings without reloading the page. ([#322](https://github.com/federicovezzoli/furrow-cam/pull/322))
- Updated dependencies: @furrow/workspace@0.11.0, @furrow/ui@0.3.0, @furrow/document@0.13.0, @furrow/cam-core@0.12.0, @furrow/post@0.10.0

## 0.16.1

### Patch Changes

- Updated dependencies: @furrow/cam-core@0.11.0, @furrow/workspace@0.10.0, @furrow/document@0.12.0, @furrow/post@0.9.1, @furrow/ui@0.2.1

## 0.16.0

### Minor Changes

- Furrow CAM starts in your browser's or system's language when it's English, Italian, French or German, and a new language button next to the theme toggle lets you pick another. Only a few labels are translated so far; the rest follows in upcoming releases. ([#301](https://github.com/federicovezzoli/furrow-cam/pull/301))
- Verification and password-reset emails now arrive in the language Furrow CAM is shown in when you ask for them: English, Italian, French or German. ([#302](https://github.com/federicovezzoli/furrow-cam/pull/302))
- The web app's pages, forms, messages and errors now appear in English, Italian, French or German, and dates and numbers follow the chosen language. The privacy policy stays in English, with a note saying so. ([#304](https://github.com/federicovezzoli/furrow-cam/pull/304))

### Patch Changes

- Toolpath and import warnings, file errors, export messages and form validation now appear in English, Italian, French or German. ([#305](https://github.com/federicovezzoli/furrow-cam/pull/305))
- A project or saved version that can't be upgraded to this release now says why when opened in the desktop app or from a `.furrow` archive, as it already did on the web. ([#289](https://github.com/federicovezzoli/furrow-cam/pull/289))
- The CAM workspace, including its operations, bit and machine forms, machine presets, simulator and guided tour, now appears in English, Italian, French or German. In Italian, French and German, number fields also accept a comma as the decimal point. ([#306](https://github.com/federicovezzoli/furrow-cam/pull/306))
- Updated dependencies: @furrow/document@0.11.0, @furrow/cam-core@0.10.0, @furrow/post@0.9.0, @furrow/workspace@0.9.0, @furrow/ui@0.2.0

## 0.15.0

### Minor Changes

- A model's border is now editable next to **Fit to stock** (10 mm by default, 0 to fit edge to edge), and the Position fields say more clearly that they move the model rather than set the border. ([#272](https://github.com/federicovezzoli/furrow-cam/pull/272))

### Patch Changes

- Sign-in, password reset and account deletion limits now hold across all servers, so spreading password guesses over several requests no longer gets around them. ([#288](https://github.com/federicovezzoli/furrow-cam/pull/288))
- Updated dependencies: @furrow/document@0.10.0, @furrow/cam-core@0.9.0, @furrow/workspace@0.8.0, @furrow/post@0.8.2, @furrow/ui@0.1.6

## 0.14.0

### Minor Changes

- Anonymous usage statistics and error reports with PostHog replace GoatCounter page-view counts: no cookies, nothing linked to your account, and no projects, file names or drawings sent. The desktop app asks first and can be switched off in the Help menu. ([#285](https://github.com/federicovezzoli/furrow-cam/pull/285))
- Report a bug from the workspace's top bar, the footer or the desktop app's Help menu: it opens a GitHub issue filled in with your description and diagnostics you can review first, plus a screenshot of the viewport to paste into it. ([#282](https://github.com/federicovezzoli/furrow-cam/pull/282))

### Patch Changes

- Updated dependencies: @furrow/workspace@0.7.0, @furrow/post@0.8.1

## 0.13.0

### Minor Changes

- G-code now waits for the spindle to reach speed (`G4`) after starting it or raising its speed, before the bit moves. Machine profiles have a spin-up delay, 5 seconds by default, for existing machines and projects too; a manual spindle, switched on by hand, gets no wait. ([#264](https://github.com/federicovezzoli/furrow-cam/pull/264))

### Patch Changes

- Autosave no longer stops for the rest of the session after a refusal you can fix, such as being signed out, an edit the project can't store, or a model whose file isn't uploaded: it saves again with the next change, or when you come back to the window. A conflict with a save made elsewhere still stops it. ([#266](https://github.com/federicovezzoli/furrow-cam/pull/266))
- Leaving a project with changes that can't be saved, through All projects, another in-app link or the browser's Back button, now asks first instead of dropping them. ([#267](https://github.com/federicovezzoli/furrow-cam/pull/267))
- Updated dependencies: @furrow/workspace@0.6.0, @furrow/document@0.9.0, @furrow/cam-core@0.8.4, @furrow/post@0.8.0, @furrow/ui@0.1.5

## 0.12.1

### Patch Changes

- Uploaded STL files are now always stored and served as binary downloads, so the storage bucket can't be used to host web pages or other content. ([#268](https://github.com/federicovezzoli/furrow-cam/pull/268))
- Updated dependencies: @furrow/cam-core@0.8.3, @furrow/post@0.7.3, @furrow/ui@0.1.4, @furrow/workspace@0.5.1

## 0.12.0

### Minor Changes

- Without an account, projects now have their own addresses (`/projects/…`) like an account's, you can add and edit your own bits, and `/new` opens a new project straight in the workspace. The project list mentions the desktop app as a way to keep your work. ([#237](https://github.com/federicovezzoli/furrow-cam/pull/237))

### Patch Changes

- Updated dependencies: @furrow/workspace@0.5.0

## 0.11.0

### Minor Changes

- Operations can now use common bits from a built-in catalog (flat end mills in metric and imperial sizes, ball nose and V-bits), with cautious feeds for softwood and plywood. Editing a catalog bit saves your own copy to your library. ([#230](https://github.com/federicovezzoli/furrow-cam/pull/230))
- Without an account, exporting G-code, setting up a machine or saving your own bits now explains what they need, with a free account, the desktop app for your system, or the project saved as a file. ([#232](https://github.com/federicovezzoli/furrow-cam/pull/232))
- After you sign in, projects you made in the same browser without an account can be imported into your account, or discarded. ([#233](https://github.com/federicovezzoli/furrow-cam/pull/233))
- You can use Furrow CAM without an account: app.furrow.cam opens the workspace straight away, and your projects are kept in your browser until you sign up. ([#231](https://github.com/federicovezzoli/furrow-cam/pull/231))
- You can create and import projects before adding a machine, and choose the machine in the project when you're ready to export G-code. ([#228](https://github.com/federicovezzoli/furrow-cam/pull/228))

### Patch Changes

- The privacy policy explains that projects made without an account stay in your browser. ([#234](https://github.com/federicovezzoli/furrow-cam/pull/234))
- Updated dependencies: @furrow/document@0.8.0, @furrow/workspace@0.4.0, @furrow/cam-core@0.8.2, @furrow/post@0.7.2, @furrow/ui@0.1.3

## 0.10.3

### Patch Changes

- The privacy policy now covers the desktop app's download links. ([#217](https://github.com/federicovezzoli/furrow-cam/pull/217))

## 0.10.2

### Patch Changes

- The Furrow CAM logo is now a toolpath tracing the outline of an F, used for the favicons, the installable web app and the desktop app icon. ([`033a756`](https://github.com/federicovezzoli/furrow-cam/commit/033a756b90c6014de4ab969143c415999782d157))

## 0.10.1

### Patch Changes

- Importing a `.furrow` file no longer fails when only one of its saved versions uses a model larger than the server's STL size limit; models the project itself uses are still held to that limit. ([#203](https://github.com/federicovezzoli/furrow-cam/pull/203))
- The desktop app now remembers the workspace's panel sizes and collapsed panes between projects and launches, as the web app does. ([#207](https://github.com/federicovezzoli/furrow-cam/pull/207))
- Updated dependencies: @furrow/document@0.7.1, @furrow/workspace@0.3.0, @furrow/cam-core@0.8.1, @furrow/post@0.7.1, @furrow/ui@0.1.2

## 0.10.0

### Minor Changes

- Project files can now carry the project's saved versions, ready for the desktop app's `.furrow` files. Import also accepts `.furrow` files, bringing in the project without its versions. ([#192](https://github.com/federicovezzoli/furrow-cam/pull/192))
- Importing a file no longer adds a touch-off pad: tick **Touch-off pad** in the zero settings, and it is placed on the XY zero. The pad can have its own tool-change G-code, suggested from the machine's with its move put on the pad, and the viewport marks it with a dashed ring and a "Z touch-off" label instead of a disc that looked like the bit. ([#182](https://github.com/federicovezzoli/furrow-cam/pull/182))

### Patch Changes

- The touch-off pad now moves with the design when the stock is resized or the XY zero changes anchor, and stays on the stock instead of being left past its edge. ([#182](https://github.com/federicovezzoli/furrow-cam/pull/182))
- Updated dependencies: @furrow/workspace@0.2.0, @furrow/ui@0.1.1, @furrow/document@0.7.0, @furrow/cam-core@0.8.0, @furrow/post@0.7.0

## 0.9.0

### Minor Changes

- Furrow CAM can now be installed as an app from Chrome, Edge and Safari, opening your projects in its own window, and has a new icon. ([#175](https://github.com/federicovezzoli/furrow-cam/pull/175))
- Play back the cut move by move: the new Simulate button next to Export G-code opens the project's simulator, where the stock is cut as the tool advances, drawn with its real shape, with the toolpath drawn behind it and a timeline to play, pause, change speed, scrub and jump between operations. ([#173](https://github.com/federicovezzoli/furrow-cam/pull/173))

### Patch Changes

- The model properties show an imported model's original size and its current scale, with an "Original size" button that scales it back to 1:1. ([#176](https://github.com/federicovezzoli/furrow-cam/pull/176))
- The simulated stock is sharper: twice the resolution, flat floors and crisp walls, so cuts made with a flat end mill look like they will on the machine. ([#174](https://github.com/federicovezzoli/furrow-cam/pull/174))
- Updated dependencies: @furrow/post@0.6.0, @furrow/cam-core@0.7.0

## 0.8.0

### Minor Changes

- 3D finishing can cut waterline contours at constant height, which finish steep faces evenly, or one continuous spiral, besides parallel passes. ([#150](https://github.com/federicovezzoli/furrow-cam/pull/150))
- 3D roughing can clear the model plus a margin around it, leaving the stock top beyond it uncut so Z can be zeroed on it after a tool change. Imported models, and models fitted to the stock again, now leave a 10 mm border around them. ([#148](https://github.com/federicovezzoli/furrow-cam/pull/148))
- Projects zeroed on the stock top get a touch-off pad: a spot of the stock top that 3D operations never cut and 2D operations warn about, where the machine stops at each tool change so Z can be zeroed again. Its position and size are set with the zero point. ([#157](https://github.com/federicovezzoli/furrow-cam/pull/157))

### Patch Changes

- Exporting G-code reuses the toolpaths the workspace has already computed instead of computing every one again, so a project with 3D operations exports at once. ([#158](https://github.com/federicovezzoli/furrow-cam/pull/158))
- Updated dependencies: @furrow/cam-core@0.6.0, @furrow/post@0.5.0, @furrow/document@0.6.0

## 0.7.0

### Minor Changes

- New accounts get a short guided tour of the app and of the workspace, pointing at the bits, machines, import, properties, operations, preview and G-code export. It shows once per account, and **Take the tour** in the account menu or the workspace's **?** button replays it. ([#143](https://github.com/federicovezzoli/furrow-cam/pull/143))
- Projects can store 3D model files in S3-compatible storage, the groundwork for STL import. The privacy policy now lists Cloudflare R2, which stores those files in the European Union. ([#122](https://github.com/federicovezzoli/furrow-cam/pull/122))
- The operation's tool select ends with a "New bit…" option, so you can add a bit to your library and pick it without leaving the workspace. ([#142](https://github.com/federicovezzoli/furrow-cam/pull/142))
- Projects with 3D models now export as a single `.furrow.zip` file holding the project and its STL meshes, and import back from it; projects without models still export as `.furrow.json`. ([#135](https://github.com/federicovezzoli/furrow-cam/pull/135))
- Finish STL models with 3D parallel passes at any angle, with step-over, one-way or zig-zag direction and stock to leave, then preview, simulate and export them to G-code like other operations. Long toolpaths show their progress and can be cancelled. ([#129](https://github.com/federicovezzoli/furrow-cam/pull/129))
- 3D roughing and finishing can now cut only the material the operations before them left, so a smaller bit only works where a larger one couldn't reach, without cutting air. ([#136](https://github.com/federicovezzoli/furrow-cam/pull/136))
- Rough out STL models in Z levels with the pocket clearing strategies, leaving stock for finishing, across the model's outline or the whole stock, with a step-over of their own if needed. Changing an operation's strategy or another choice no longer shows its old toolpath while the new one computes. ([#131](https://github.com/federicovezzoli/furrow-cam/pull/131))
- Import STL models (binary or ASCII) into a project, turn, size and position them on the stock, and see them in the viewport as they will be cut from the top. Instances can limit an STL file's size and triangle count. ([#124](https://github.com/federicovezzoli/furrow-cam/pull/124))
- A monthly clean-up deletes uploaded 3D models that were never finished, and models uploaded after their project was deleted. ([#137](https://github.com/federicovezzoli/furrow-cam/pull/137))

### Patch Changes

- An STL import that fails because another file was imported while it uploaded no longer leaves its upload in storage. ([#139](https://github.com/federicovezzoli/furrow-cam/pull/139))
- Collapsing or expanding a sidebar pane no longer opens or closes the other panes, and the workspace page no longer scrolls past the window. ([`08c4e68`](https://github.com/federicovezzoli/furrow-cam/commit/08c4e68c08c9a9f2754707708565b261798a3528))
- Models keep their proportions: resizing one scales its depth too, and a model deeper than the stock is no longer squashed to fit but cut off at the stock's bottom. ([#131](https://github.com/federicovezzoli/furrow-cam/pull/131))
- A model whose copy in the browser's cache is damaged is now downloaded again, instead of showing "The stored model doesn't match its file." until the site's data is cleared. ([#141](https://github.com/federicovezzoli/furrow-cam/pull/141))
- A model preview that failed because the model worker stopped or its file couldn't be downloaded is now tried again, instead of showing only the model's outline until the page is reloaded. ([#140](https://github.com/federicovezzoli/furrow-cam/pull/140))
- Updated dependencies: @furrow/document@0.5.0, @furrow/cam-core@0.5.0, @furrow/post@0.4.0

## 0.6.0

### Minor Changes

- Projects can be saved as named versions from the new Versions pane, then restored, renamed, deleted or opened as a new project. Restoring keeps the current state as a version first. ([#110](https://github.com/federicovezzoli/furrow-cam/pull/110))

## 0.5.0

### Minor Changes

- [#104](https://github.com/federicovezzoli/furrow-cam/pull/104) [`7ad6b23`](https://github.com/federicovezzoli/furrow-cam/commit/7ad6b23fc1664c80ee5a155268372e1c1c99eda0) Thanks [@federicovezzoli](https://github.com/federicovezzoli)! - Verification and password-reset emails are now branded HTML (React Email templates in `src/emails/`) with a plain-text alternative rendered from the same template; preview them with `pnpm email:dev`.

- [#105](https://github.com/federicovezzoli/furrow-cam/pull/105) [`5c204cb`](https://github.com/federicovezzoli/furrow-cam/commit/5c204cb7658106c7f80ebf92fbce59d48ba4c801) Thanks [@federicovezzoli](https://github.com/federicovezzoli)! - Sign-up and password reset reject passwords found in the Have I Been Pwned breach corpus (only a 5-character hash prefix is sent; if the service is unreachable the password is accepted), and the 8–128 character length limits are set explicitly, with the minimum shared with the forms. Password reset is rate-limited like sign-in.

- [#98](https://github.com/federicovezzoli/furrow-cam/pull/98) [`cc7ae78`](https://github.com/federicovezzoli/furrow-cam/commit/cc7ae785bdfd27dc7a20fba74779275fedd4999b) Thanks [@federicovezzoli](https://github.com/federicovezzoli)! - The imported drawing is aligned to the stock at the XY zero's anchor (ADR-0022). Importing a file places the drawing's bounding box on the stock at the current anchor (at the bottom-left corner for a custom zero), whatever its origin in the file, and choosing an anchor re-aligns it, moving the profiles' tab positions with it, as one undo step; choosing the current anchor aligns a drawing that isn't. Resizing the stock moves the drawing with an anchored zero, so an aligned drawing stays aligned. Setting a custom zero leaves the drawing where it is, and so does resizing the stock under one. Snapping to a shape's bounding box uses its exact bounds. A project holds one imported file for now: Import is disabled while it has shapes. SVG files with no page size are no longer moved onto y = 0 and no longer warn about it. `@furrow/cam-core` adds `pathBounds`, `shapesBounds`, `anchorPoint`, `anchorAlignment`, `alignShapes`, `xyOriginShift`, `translatePoint`, `translatePath`, `translateShape` and `translateShapes`.

- [#102](https://github.com/federicovezzoli/furrow-cam/pull/102) [`eb7b875`](https://github.com/federicovezzoli/furrow-cam/commit/eb7b875b9b01c5ee60da1b1795a130513acb3a11) Thanks [@federicovezzoli](https://github.com/federicovezzoli)! - Add an engrave operation (PRD-0001 R21): it follows every selected path on the line, open and closed, or the closed ones inside or outside the line with the tool centre half the groove's width away, so one edge of the groove is on the line (open paths are then skipped with a warning). It cuts to a depth in passes no deeper than the tool's step-down, with an optional ramp in. With a V-bit the line width can be typed instead of the depth, converted from the bit's angle and tip diameter, and a depth past the cone is warned about. V-bits, ball and flat end mills can engrave; drill bits can't. New engravings start on the line, with the first V-bit in the library, 1 mm deep. Documents move to schema version 5 with no changes to existing data. `@furrow/document` adds `EngraveParams`, `EngraveOperation` and `canEngrave`; `@furrow/cam-core` adds `engraveToolpath`, `contourToolpath` (the profile toolpath with an explicit tool-centre offset, which profiles and engravings share), `grooveWidth`, `vBitLineWidth`, `vBitDepthForWidth`, `vBitConeDepth` and `exceedsVBitCone`. The profile's warning for skipped open paths now reads "inside and outside cuts need closed paths".

- [`08cb76e`](https://github.com/federicovezzoli/furrow-cam/commit/08cb76eaa1c9bdf3324b86bc3218d1d4e3913df4) Thanks [@federicovezzoli](https://github.com/federicovezzoli)! - Workspace: the Properties pane always shows the project's settings. The selected operation's settings now open in a panel floating over the top right corner of the viewport; close it, or click the operation again, to dismiss it.

- [#93](https://github.com/federicovezzoli/furrow-cam/pull/93) [`b552386`](https://github.com/federicovezzoli/furrow-cam/commit/b55238694fd3a4532ce5bfcef3ae8e42935bbf32) Thanks [@federicovezzoli](https://github.com/federicovezzoli)! - Add and edit bits from the library in a dialog, the same one the workspace uses, instead of on separate pages. The `/tools/new` and `/tools/[id]` pages are removed.

- [#103](https://github.com/federicovezzoli/furrow-cam/pull/103) [`2e38684`](https://github.com/federicovezzoli/furrow-cam/commit/2e38684f73618878c1b184736b0882df9b5c2d6b) Thanks [@federicovezzoli](https://github.com/federicovezzoli)! - Workspace: the Geometry pane is gone, so the Operations pane fills the left column. Import an SVG or DXF file from the card in the empty viewport (import warnings show in the viewport's corner until dismissed), and select paths in the viewport; the Operations pane shows what is selected, with Select inside and Clear.

- [#92](https://github.com/federicovezzoli/furrow-cam/pull/92) [`f328969`](https://github.com/federicovezzoli/furrow-cam/commit/f32896993f837f894efa8b8aee9b4d9bec1d2f4f) Thanks [@federicovezzoli](https://github.com/federicovezzoli)! - Pocket clearing strategies (PRD-0001 R20). `PocketParams.strategy` is `{ type: "offset" }` (today's rings from the centre out), `{ type: "linear", angle }` with an angle of 0, 90, 45 or −45 degrees, or `{ type: "peel", start }` starting from the `centre`, the `inside` (the pocket's single island) or the `outside` (the outer wall). Document schema version 4: the migration gives existing pockets offset clearing, and new pockets start with it. Linear clearing cuts a lap around every wall and island on each level, then zig-zag passes one step-over apart from lap to lap, linked along the lap when the link stays between neighbouring passes, so passes are entered at depth. Peel clearing grows the cleared area a step-over at a time from a starting cut (a helix one step-over across the point furthest from the walls, or a full lap along the island or the outer wall), cutting only what each step adds, so the tool never cuts wider than the step-over after the starting cut; a pocket without exactly one island gets no toolpath and the warning "Peel from the island needs exactly one island." Allowance, finish pass, ramping and retract minimisation work as before for every strategy, and so does the direction, except for linear passes, which alternate it: there it applies to the laps and the finish pass. Between passes the tool also stays at depth over what it has cut: along the lap it is on for linear, through the area every earlier step has cleared for peel. The pocket form gains a strategy picker with the angle or the start. `@furrow/cam-core` adds `simplify` to the geometry adapter.

- [#90](https://github.com/federicovezzoli/furrow-cam/pull/90) [`e26a9c2`](https://github.com/federicovezzoli/furrow-cam/commit/e26a9c2928adb0e3858edafff887980a7d1ca0ed) Thanks [@federicovezzoli](https://github.com/federicovezzoli)! - Privacy policy at `/privacy`, linked from the sign-up page and the footer. The header's Sign out button becomes an Account menu showing the signed-in email, with Sign out and Delete account; deletion asks for the password, is immediate and removes the user's projects, bits, machines and sessions.

- [#103](https://github.com/federicovezzoli/furrow-cam/pull/103) [`2e38684`](https://github.com/federicovezzoli/furrow-cam/commit/2e38684f73618878c1b184736b0882df9b5c2d6b) Thanks [@federicovezzoli](https://github.com/federicovezzoli)! - Workspace: Operations and Properties now share the left column, so the viewport gets the rest of the width. Click a pane's header to collapse it to just the header, or to expand it again; the split between them is remembered. Export G-code moved to the bottom of the Operations pane (and is off until the project has an operation) and Export project file to the bottom of the Properties pane.

- [#108](https://github.com/federicovezzoli/furrow-cam/pull/108) [`c37461f`](https://github.com/federicovezzoli/furrow-cam/commit/c37461f8e309bebc17b358d464d260eaa35b933e) Thanks [@federicovezzoli](https://github.com/federicovezzoli)! - Add a V-carve operation (PRD-0001 R16): a V-bit follows the medial axis of the selected closed paths, as deep at each point as its angle and tip need to reach the nearest edge, so corners are carved right into and wider parts go deeper. Islands, such as the middle of an O, stay standing. It goes no deeper than the operation's maximum depth or the bit's cone, in passes no deeper than the bit's step-down, and feeds back along the groove it already cut between passes instead of retracting. Without a flat bottom, parts wider than the bit reaches at the maximum depth are carved along the axis only, with a warning. With one, a flat end mill clears them flat at that depth first, and the V-bit then carves their walls. The G-code cuts the two as separate steps with a tool change between them (ADR-0026). The preview shades V-carve toolpaths darker the deeper they go and draws the clearing moves in the end mill's colour, and the simulation cuts them with the end mill. The simulation's grid now has six cells across the narrowest groove rather than the smallest tool: a V-bit's groove a quarter of the way down its deepest cut, a ball end mill's chord at its depth. Each move only sweeps as far as the tool reaches below the stock top, so V-carves and shallow V-bit engravings show their shape instead of a few coarse cells. New V-carves go as deep as the bit's cone, but no deeper than half the stock. Documents move to schema version 6 with no changes to existing data.
  
  `@furrow/document` adds `VCarveParams`, `VCarveOperation`, `canVCarve`, `canClearFlatBottom` and `clearingTool`. `@furrow/cam-core` adds `vcarveToolpath` and `clearPocket` (a pocket of polygons), an optional `clearing` move list on `Toolpath`, and `feedColors` on `ToolpathLines` (`shadeDepth` option); `smallestDiameter` is replaced by `smallestCutWidth`. `medialAxis` no longer returns the specks that graded sampling grows at each step of a drawn edge (rounded coordinates, dense polylines), which V-carving cut as hundreds of separate runs, each with a plunge and a retract; a tiny piece within 0.01 mm of the rest of the axis, such as the tip of a very sharp corner, is joined to it instead. `@furrow/post` adds `postSteps`, which splits each operation into one step per tool.

### Patch Changes

- [#103](https://github.com/federicovezzoli/furrow-cam/pull/103) [`2e38684`](https://github.com/federicovezzoli/furrow-cam/commit/2e38684f73618878c1b184736b0882df9b5c2d6b) Thanks [@federicovezzoli](https://github.com/federicovezzoli)! - Compact primary buttons (such as Import in the SVG DPI and DXF units prompts) show their text in the button's foreground colour again: class merging now knows the workspace's `text-ui` and `control` theme tokens.

- [#103](https://github.com/federicovezzoli/furrow-cam/pull/103) [`2e38684`](https://github.com/federicovezzoli/furrow-cam/commit/2e38684f73618878c1b184736b0882df9b5c2d6b) Thanks [@federicovezzoli](https://github.com/federicovezzoli)! - Operations pane: the buttons that add a profile, pocket, drill or engrave operation are now four aligned tiles, each with an icon showing the toolpath it makes.
- Updated dependencies [[`cc7ae78`](https://github.com/federicovezzoli/furrow-cam/commit/cc7ae785bdfd27dc7a20fba74779275fedd4999b), [`eb7b875`](https://github.com/federicovezzoli/furrow-cam/commit/eb7b875b9b01c5ee60da1b1795a130513acb3a11), [`d94bb85`](https://github.com/federicovezzoli/furrow-cam/commit/d94bb8589fcf968d9171ede3c540de3c678c4e51), [`f328969`](https://github.com/federicovezzoli/furrow-cam/commit/f32896993f837f894efa8b8aee9b4d9bec1d2f4f), [`c37461f`](https://github.com/federicovezzoli/furrow-cam/commit/c37461f8e309bebc17b358d464d260eaa35b933e)]:
  - @furrow/cam-core@0.4.0
  - @furrow/document@0.4.0
  - @furrow/post@0.3.0

## 0.4.0

### Minor Changes

- [#71](https://github.com/federicovezzoli/furrow-cam/pull/71) [`6a41b05`](https://github.com/federicovezzoli/furrow-cam/commit/6a41b05ab4404433e91abd63f83095bd7f51d7fd) Thanks [@federicovezzoli](https://github.com/federicovezzoli)! - Import DXF files into the project geometry: lines, arcs, circles, polylines with bulges (old and lightweight), ellipses, splines, points and block references (with scale, rotation and arrays), keeping layer names and the drawing's coordinates, so DXF (0, 0) is the stock's bottom-left corner. `$INSUNITS` sets the units, and the user picks millimetres or inches on import when the file has none. Open entities on a layer whose ends meet are joined into one path, closed when it loops back, so outlines exported as separate lines and arcs can be profiled and pocketed. Circles and arcs stay arcs; ellipses and splines become cubics, exactly for splines up to degree 3 and within 0.001 mm otherwise. Entities with extrusion −Z are mirrored as DXF specifies; tilted ones, text, dimensions, hatches, solids, paper space and layers that are off or frozen are skipped with a warning, and binary DXF is refused. Files before AutoCAD 2007 are decoded with their code page. `@furrow/cam-core` adds `parseDxf`, `importDxf`, `dxfNeedsUnits`, `dxfUnitScale` and `DxfImportError`.

- [#78](https://github.com/federicovezzoli/furrow-cam/pull/78) [`6368e82`](https://github.com/federicovezzoli/furrow-cam/commit/6368e82da0b18fb92f7b06cd1721f4a64f7ec456) Thanks [@federicovezzoli](https://github.com/federicovezzoli)! - Edit the selected bit's settings in a modal from the operation properties; saving updates the library and every operation in the project that used the bit.

- [#73](https://github.com/federicovezzoli/furrow-cam/pull/73) [`bcfc0e3`](https://github.com/federicovezzoli/furrow-cam/commit/bcfc0e31f382495aeac322f79137adbe1f69f211) Thanks [@federicovezzoli](https://github.com/federicovezzoli)! - Entry clearance in machine profiles. Machines have an `entryClearance`: the height above the stock top where rapids down stop and feeding starts, from 0 up to `safeZ`, 1 mm by default (`DEFAULT_ENTRY_CLEARANCE` in `@furrow/document`). Existing machines and, through a document schema v3 migration, machine snapshots keep what toolpaths used before: 1 mm, capped at their safe Z. The machine form has an "Entry clearance (above stock)" field and the machines table a column for it. In `@furrow/cam-core`, `ToolpathInput` and the profile, pocket and drill options take `entryClearance`, from the project's machine or the default without one; `ToolpathBuilder` takes it next to `safeZ` and caps it there. Only rapids down use it: pockets on their first pass and bores between rings now cross uncut stock at the retract height instead of just above it. `ENTRY_CLEARANCE` is removed.

- [#74](https://github.com/federicovezzoli/furrow-cam/pull/74) [`0d7829b`](https://github.com/federicovezzoli/furrow-cam/commit/0d7829b880820ab9c59ade81e0757428d35ee73d) Thanks [@federicovezzoli](https://github.com/federicovezzoli)! - Simulate material removal (PRD-0001 R10, ADR-0019): a new group in the viewport toolbar holds a toggle that shows the stock as it will look after cutting in place of the stock box, with the toolpaths still drawn over it, and a button that shows or hides every operation's toolpath at once (the Operations pane still does it per operation). The simulation is a heightmap over the stock with six cells across the smallest tool in use, capped at 2048 × 4096 cells (fewer on devices whose textures can't hold them). Each move of every enabled operation, rapids included, sweeps its tool's shape across it (flat for end mills and drills, a hemisphere for ball end mills, a cone over the tip for V-bits), exactly along ramps. It runs in its own Web Worker whenever the toolpaths or the stock change while it is shown, and is drawn as one instanced surface lifted from a float texture, with walls down to the stock bottom and cuts darker the deeper they go. While toolpaths recompute or it simulates, the last result stays with a "Simulating…" note, and operations whose toolpath failed are named as not simulated. Turning on tab editing or zero picking turns it off. `@furrow/cam-core` adds `simulateCuts`, `heightmapGrid`, `cutterProfile`, `smallestDiameter`, `heightmapBuffers`, `CELLS_PER_DIAMETER` and `MAX_HEIGHTMAP_CELLS`.

- [#81](https://github.com/federicovezzoli/furrow-cam/pull/81) [`2315823`](https://github.com/federicovezzoli/furrow-cam/commit/23158238f910388fce08bbf046583611ed4ef879) Thanks [@federicovezzoli](https://github.com/federicovezzoli)! - Machine presets (PRD-0004). `@furrow/document` adds `MACHINE_PRESETS`, a catalog of popular hobby routers whose values all come from official documentation with their sources: V1 Engineering LowRider v4 and MPCNC Primo (build-to-size, with V1 Engineering's Jackpot G-code), Maslow 4, Sienci LongMill MK2 (12x30, 30x30, 48x30) and SainSmart Genmitsu 3018 REX and PROVer V2. Values no official source states are asked of the user, and conflicting official values resolve to the most conservative one. It also adds `presetMachine`, `presetName`, `askedFields` and `NEW_MACHINE_DEFAULTS`. The New machine page offers "Start from a preset" (grouped by maker, searchable), showing the preset's firmware, notes, what to fill in and its sources, then pre-filling the form, or "Start from scratch". The projects page points users without a machine there.

- [#87](https://github.com/federicovezzoli/furrow-cam/pull/87) [`132eebd`](https://github.com/federicovezzoli/furrow-cam/commit/132eebdda8082031f3b4a1f0cfd5fe6daa1b7b3f) Thanks [@federicovezzoli](https://github.com/federicovezzoli)! - Count page views with GoatCounter when `NEXT_PUBLIC_GOATCOUNTER_URL` is set: no cookies and no third-party script, one count per navigation, and only the route pattern (e.g. `/projects/[id]`) is sent, never IDs, query strings or same-origin referrers.

- [#72](https://github.com/federicovezzoli/furrow-cam/pull/72) [`abf54ba`](https://github.com/federicovezzoli/furrow-cam/commit/abf54ba52f541274a4c33631c17ca3e24492382f) Thanks [@federicovezzoli](https://github.com/federicovezzoli)! - Select paths by clicking in the viewport, and cut single paths of a shape ([#54](https://github.com/federicovezzoli/furrow-cam/issues/54), ADR-0018). Operations now reference `targets: [{ shapeId, paths }]` (`paths` the indices of the shape's paths, ascending, or `null` for all of them) instead of `shapeIds`, in project document schema v2; v1 documents migrate to whole-shape targets. Toolpaths are generated from the targeted paths only, so an outline and its holes imported as one element can be profiled and drilled separately. In the top view, clicking a path selects it, Ctrl/Cmd/Shift+click toggles it and clicking outside every path clears the selection; the path under the cursor is highlighted. A path is picked when its line is within 6 pixels of the cursor, or else by being the innermost closed path around it. Selecting a shape in the Geometry pane selects all its paths, and a shape with only some selected shows how many. **Select inside** in the Geometry pane adds every closed path inside the area the selected ones enclose (even-odd, as pockets read it), of any shape, so a pocket's islands are selected in one click. Drill points are picked by the cross they are drawn as. **Add …** and **Use selected** use the selected paths, and the operation's shape list says how many of a shape's paths it cuts. `@furrow/document` adds `normalizeTargets`; `@furrow/cam-core` adds `targetedShapes`, `pickablePaths`, `pathAt`, `pathKey`, `closedPathsInside` and `containmentIn`.

- [#79](https://github.com/federicovezzoli/furrow-cam/pull/79) [`f9dea74`](https://github.com/federicovezzoli/furrow-cam/commit/f9dea747ca5822e51dfb0b8ab100c788f0b664fd) Thanks [@federicovezzoli](https://github.com/federicovezzoli)! - Projects are now created for a machine: its profile is snapshotted into the project, so G-code export uses its post-processor, limits and custom blocks. Creating or importing a project needs a machine (with several, one is chosen); the project list and workspace show each project's machine, the workspace properties can change it (undoable), and projects without one can't export G-code until it is set.

- [#66](https://github.com/federicovezzoli/furrow-cam/pull/66) [`a6a027f`](https://github.com/federicovezzoli/furrow-cam/commit/a6a027f6ebeb0707fe962ed21edd9773ead84317) Thanks [@federicovezzoli](https://github.com/federicovezzoli)! - Add a footer outside the project editor (landing page, sign-in/sign-up and account pages) with the app version linking to its GitHub release, a link to the repository, and credits and license.

### Patch Changes

- [#84](https://github.com/federicovezzoli/furrow-cam/pull/84) [`9089604`](https://github.com/federicovezzoli/furrow-cam/commit/9089604dacfe6b4ec03a23d8270bec8d4212a47d) Thanks [@federicovezzoli](https://github.com/federicovezzoli)! - Sign-in, sign-up and reset-password have a show/hide toggle on the password field.
- Updated dependencies [[`6a41b05`](https://github.com/federicovezzoli/furrow-cam/commit/6a41b05ab4404433e91abd63f83095bd7f51d7fd), [`bcfc0e3`](https://github.com/federicovezzoli/furrow-cam/commit/bcfc0e31f382495aeac322f79137adbe1f69f211), [`0d7829b`](https://github.com/federicovezzoli/furrow-cam/commit/0d7829b880820ab9c59ade81e0757428d35ee73d), [`2315823`](https://github.com/federicovezzoli/furrow-cam/commit/23158238f910388fce08bbf046583611ed4ef879), [`abf54ba`](https://github.com/federicovezzoli/furrow-cam/commit/abf54ba52f541274a4c33631c17ca3e24492382f), [`abf54ba`](https://github.com/federicovezzoli/furrow-cam/commit/abf54ba52f541274a4c33631c17ca3e24492382f)]:
  - @furrow/cam-core@0.3.0
  - @furrow/document@0.3.0
  - @furrow/post@0.2.1

## 0.3.0

### Minor Changes

- [`9e8c083`](https://github.com/federicovezzoli/furrow-cam/commit/9e8c083ffc0cfd0a79357576112cc5fd9a876b82) Thanks [@federicovezzoli](https://github.com/federicovezzoli)! - Add accounts: PostgreSQL via Prisma, email and password sign-up with email verification and password reset (Better Auth + Resend), and a protected projects page.

- [`99256ed`](https://github.com/federicovezzoli/furrow-cam/commit/99256edf0b75517a91abbf57252df1c6da1ec858) Thanks [@federicovezzoli](https://github.com/federicovezzoli)! - Stop collecting names: sign-up asks only for email and password, the stored name always mirrors the email, and avatars are cleared.

- [#53](https://github.com/federicovezzoli/furrow-cam/pull/53) [`bca37a9`](https://github.com/federicovezzoli/furrow-cam/commit/bca37a99f77a889384ad5d3dddc8f2c34bf5b0ba) Thanks [@federicovezzoli](https://github.com/federicovezzoli)! - Drill operation. A drill operation's params are a `depth` (of the tool tip below the stock top) and `peck`. Holes are single-point paths and closed paths a circle fits within 0.1 mm on the diameter (every point of the outline within 0.05 mm of one radius), so circles exported as polygons or Béziers, like OpenSCAD's 36-gons, count while coarse polygons don't; a hole's size is the circle through its farthest points. The tool plunges into points and the circles it fits: straight to depth at its plunge rate, or with pecking in equal pecks no deeper than its step-down, retracting to just above the stock after each. An end mill bores larger circles with climb helices no steeper than its plunge angle (along the chords) and no more than its step-down per turn, each ending with a full turn at depth, in rings from the inside out no further apart than its step-over when the hole is over twice its diameter; a ring shorter than the tool radius is plunged a step-down at a time with a turn at each depth instead; a drill bit skips them, and circles smaller than the tool are skipped, with a warning. Holes are ordered to shorten travel: nearest neighbour from the hole nearest the stock's bottom-left corner, then 2-opt. Drills and end mills can drill, V-bits can't (`canDrill`). In the Operations pane, "Add drill" creates one with the default tool (or the first that can drill), through the stock and pecking; the Properties panel edits its depth and pecking. `@furrow/cam-core` adds `drillToolpath`, `drillOrder`, `DRILL_DIAMETER_TOLERANCE` and `arcStep`.

- [#60](https://github.com/federicovezzoli/furrow-cam/pull/60) [`921cb07`](https://github.com/federicovezzoli/furrow-cam/commit/921cb07a6c9de23107e0f5457734e1441fb35e6b) Thanks [@federicovezzoli](https://github.com/federicovezzoli)! - GRBL post-processor and G-code export ([#26](https://github.com/federicovezzoli/furrow-cam/issues/26)). `@furrow/post` defines the `PostProcessor` interface and a registry (`POST_PROCESSORS`) for further dialects, and `exportGcode` turns a project's enabled operations into a GRBL program: millimetres and absolute coordinates measured from the work origin (every stock anchor, custom zeros and both Z zeros), feeds limited per axis to the machine's maximums and spindle speeds kept in its range (both with warnings), `M3` without `S` for manual spindles, the spindle started only after retracting to the safe height, a pause for tool changes between different bits that asks for Z to be zeroed again, and the machine's custom program start, program end, operation start and tool change blocks copied verbatim in place of the defaults, with the modes written again after them. Enabled operations left out for having no toolpath are reported. The workspace's G-code button downloads the program as a `.gcode` file, computed in a Web Worker. `projectFileName` takes an optional extension, and the test fixtures are exported as `@furrow/document/fixtures`.

- [#48](https://github.com/federicovezzoli/furrow-cam/pull/48) [`99a60af`](https://github.com/federicovezzoli/furrow-cam/commit/99a60af86f8f8226b1f8ba76bea17afb5eb9c49d) Thanks [@federicovezzoli](https://github.com/federicovezzoli)! - Holding tabs on profiles. A profile's `tabs` (or `null`) hold a width, a height above the final depth and explicit positions; each tab goes to the nearest closed contour, where the depth passes and finish pass that would cut below the tab top rise straight up over it and come back down (ramping at the plunge angle when ramping is on), and no contour starts on a tab. In the Properties panel, "Holding tabs" adds four per contour; tabs can be placed again per contour or by spacing, and are drawn in the viewport as the material they leave (the tab's width along the contour, the tool's slot across, the tab's height up from the final depth). Edit them in the top view: click a contour to add one, drag one to move it along the contours, click one to remove it. `@furrow/cam-core` adds `autoTabPositions`, `closedLoops`, `nearestOnLoops` and `tabFrame`.

- [#33](https://github.com/federicovezzoli/furrow-cam/pull/33) [`51e0cd4`](https://github.com/federicovezzoli/furrow-cam/commit/51e0cd4d95c71d9f74ca428a336627cf7ed54919) Thanks [@federicovezzoli](https://github.com/federicovezzoli)! - Add machine profiles: `Machine` table and migration, server actions to list, create, update and delete the signed-in user's machines (validated with the shared `Machine` schema), and a `/machines` page with a create/edit form. A machine has a work area, maximum feeds, a safe Z, a post-processor (GRBL) and a spindle speed range, or none for a manual spindle. It can also hold custom G-code for the program start, program end, operation start and tool change; a filled-in block replaces the post-processor's default at that point, copied verbatim. Projects will store a snapshot of their machine, so editing or deleting a machine never changes existing projects. Spindle speeds (machines and bits) are now capped at 100,000 RPM, and `Machine` rejects unknown keys like the rest of the project document; read database rows with `machineFields`.

- [#40](https://github.com/federicovezzoli/furrow-cam/pull/40) [`52e3b3a`](https://github.com/federicovezzoli/furrow-cam/commit/52e3b3a411ef391b712c84e394480e4ad17d1aa4) Thanks [@federicovezzoli](https://github.com/federicovezzoli)! - Add unit-aware number fields. Every numeric field accepts a number or a simple expression with an optional unit (`6.35`, `6.35mm`, `1/4in`, `1/4"`, `10/2`, `100 in/min`), steps with the arrow keys (Shift ×10, Alt ×0.1) and scrubs when its label is dragged sideways; counts and spindle speeds take whole numbers only. Values are stored in millimetres and shown in the project's units, which can now be switched between millimetres and inches in the workspace's Properties panel, next to the now editable stock size (a scrub, or an arrow key held down, is one undo step, and Escape cancels it). The tool and machine forms use the same fields, shown in millimetres. `@furrow/cam-core` gains `parseQuantity`, `formatQuantity`, `unitLabel`, `toInternal` and `fromInternal`, and exports `MM_PER_INCH`.

- [#47](https://github.com/federicovezzoli/furrow-cam/pull/47) [`51f8a91`](https://github.com/federicovezzoli/furrow-cam/commit/51f8a91c594376b49acd7acbc26c77efe785dbab) Thanks [@federicovezzoli](https://github.com/federicovezzoli)! - Operations pane: select shapes in the Geometry pane (Ctrl/Cmd/Shift+click to add or remove one), then add a profile cut with your default tool through the stock. Operations are listed in cutting order and can be selected, renamed (double-click or F2), enabled or disabled, moved up or down and deleted; each shows whether its toolpath is computing, failed or has warnings. While an operation is selected, the Properties panel edits its name, tool (picked from your library and snapshotted into the project), shapes and profile settings (side, direction, depth, allowance, finish pass, lead-in arc and ramp), with lengths in the project's units. Every edit is one undo step.

- [#45](https://github.com/federicovezzoli/furrow-cam/pull/45) [`a38cae2`](https://github.com/federicovezzoli/furrow-cam/commit/a38cae2ad90e497d267d523e9f474b588d08d9f0) Thanks [@federicovezzoli](https://github.com/federicovezzoli)! - Tools have a plunge angle: the steepest angle at which the bit may ramp into the material, from 1° to 90° (90° plunges straight down, drills always do). New tools default to 3°; existing ones keep 90°.

- [#52](https://github.com/federicovezzoli/furrow-cam/pull/52) [`ea50706`](https://github.com/federicovezzoli/furrow-cam/commit/ea507062530f1c671e7d798df4c339d6dfed6114) Thanks [@federicovezzoli](https://github.com/federicovezzoli)! - Pocket operation: clears the area inside closed paths with concentric offsets at the tool's step-over and step-down, from the centre out, leaving islands (nested paths) standing, with extra rings when the step-over is over half the diameter. `PocketParams` holds the direction (climb or conventional), depth, wall allowance, an optional full-depth finish pass on the walls and islands (cut once everything inside them is cleared; necks and slots too narrow for the clearing rings get depth passes of their own), and ramp entry along the ring at the tool's plunge angle. Between rings and depth passes the tool stays down inside the cleared pocket, and only retracts to the safe height when it leaves one. In the workspace, "Add pocket" creates one from the selected shapes and the Properties panel edits its params. "Ramp in" is disabled for tools with a 90° plunge angle, profiles included. `@furrow/cam-core` adds `pocketToolpath`.

- [#45](https://github.com/federicovezzoli/furrow-cam/pull/45) [`a38cae2`](https://github.com/federicovezzoli/furrow-cam/commit/a38cae2ad90e497d267d523e9f474b588d08d9f0) Thanks [@federicovezzoli](https://github.com/federicovezzoli)! - Profile toolpaths: inside, outside or on the line, in depth passes from the tool's step-down, climb or conventional, with an allowance and finish pass, a tangent lead-in and ramp entry. The workspace computes toolpaths of enabled operations in a Web Worker.

- [#35](https://github.com/federicovezzoli/furrow-cam/pull/35) [`d3c98e7`](https://github.com/federicovezzoli/furrow-cam/commit/d3c98e7dabf99a1fad1bc592f4050ca9fdf873eb) Thanks [@federicovezzoli](https://github.com/federicovezzoli)! - Export and import projects as files. Each row on `/projects` has an export button that downloads the project document, upgraded to the current schema version, as `<name>.furrow.json`; "Import file…" creates a new project from such a file, named after it. Imported files are upgraded and validated with `parseProjectDocument`, with clear errors for files that aren't projects, aren't valid or were saved by a newer version (also shown when opening such a stored project). `@furrow/document` adds `PROJECT_FILE_EXTENSION`, `projectFileName`, `projectNameFromFileName` and `ProjectDocumentTooNewError`, now thrown by `migrateProjectDocument` for documents from a newer release.

- [#34](https://github.com/federicovezzoli/furrow-cam/pull/34) [`1664d9f`](https://github.com/federicovezzoli/furrow-cam/commit/1664d9fa7fe4ba595d9b5017f663a541d89c5635) Thanks [@federicovezzoli](https://github.com/federicovezzoli)! - Add projects: `Project` table and migration (metadata columns plus the project document as `jsonb`, with a copy of its `schemaVersion`), server actions to list, create, rename, delete, load and save the signed-in user's projects (every save is validated with `ProjectDocument`, and loading upgrades older documents), and a `/projects` page to create, rename and delete them. Opening a project shows a placeholder workspace for now. The sign-out button moves to the header.

- [#42](https://github.com/federicovezzoli/furrow-cam/pull/42) [`294f207`](https://github.com/federicovezzoli/furrow-cam/commit/294f2074bdb2374344af654ed20d52b74b3ed395) Thanks [@federicovezzoli](https://github.com/federicovezzoli)! - Import SVG files into the project geometry: paths, rects, circles, ellipses, lines, polylines and polygons, with transforms, `use` references and Inkscape, Illustrator and Affinity layer names. Sizes come from `width`/`height` and `viewBox`, and the user picks the DPI on import when the file's size is in pixels or missing, and the page's bottom-left corner lands on the stock's. Circles stay arcs and other curves stay cubics in the document, flattened at any tolerance for toolpaths; hidden elements are skipped, and text and images are reported.

- [#31](https://github.com/federicovezzoli/furrow-cam/pull/31) [`a447e8b`](https://github.com/federicovezzoli/furrow-cam/commit/a447e8b7b10bb87d77b7f21a39512ab2c3fd61d9) Thanks [@github-actions](https://github.com/apps/github-actions)! - Add a per-user tool library: `Tool` table and migrations, server actions to list, create, update and delete tools and pick the default one (validated with the shared `Tool` schema), and a `/tools` page ("Bits library") showing them as a table, with drawings of each bit type in the table and the type picker. Each tool has a colour, and one tool can be the default. New accounts start with a 6 mm 2-flute upcut flat end mill as their default. Operations will store a snapshot of the tool, so editing the library never changes existing projects.

- [#56](https://github.com/federicovezzoli/furrow-cam/pull/56) [`bbf6532`](https://github.com/federicovezzoli/furrow-cam/commit/bbf6532bc09ba1c6c1d73da613fb598d621b7e4f) Thanks [@federicovezzoli](https://github.com/federicovezzoli)! - Preview toolpaths in the viewport (PRD-0001 R9): cutting moves are drawn solid in their tool's colour and rapids dashed in grey (dashes keep the same size on screen at any zoom), each operation in a few line-segment draw calls whose typed arrays are built in the toolpath worker and transferred without copying (ADR-0008), along with the warnings (the moves stay in the worker), so pockets with 100k+ segments stay smooth. While an operation recomputes, its last toolpath stays on screen, dimmed. In the top view, a circle the size of the hole marks each drilled hole, which would otherwise be invisible from above. An eye button in the Operations pane hides or shows each operation's toolpath. `@furrow/cam-core` gains `toolpathLines`, which turns a toolpath into feed and rapid segment positions, the distances that dash the rapids and, when asked for a hole radius, circles at the bottom of its straight plunges (pecks merged), and `toolpathLinesBuffers` for transferring them.

- [#39](https://github.com/federicovezzoli/furrow-cam/pull/39) [`0b8091c`](https://github.com/federicovezzoli/furrow-cam/commit/0b8091cc4b790b975be145d1376d5087a770538d) Thanks [@federicovezzoli](https://github.com/federicovezzoli)! - Add the workspace viewport (ADR-0008): a three.js canvas, loaded only in the browser, showing the stock, a millimetre grid under it, the work origin and the imported geometry as lines, with selected and hovered shapes highlighted from the workspace store. All shapes are drawn in one call, with the selection and hover drawn over them. A toolbar switches between an orthographic top view (pan with the right or middle button, zoom to the cursor with the wheel) and a perspective orbit view, and fits the camera to the stock; each view keeps its camera when you switch away and back, and resizing the stock fits it again. Geometry is stored and drawn in stock coordinates, from the stock's bottom-left corner (ADR-0014), so changing the work origin moves only the origin marker and the grid, never the design. `@furrow/cam-core` gains `flattenPath`, which turns arcs and cubic Béziers into polylines within a chord tolerance (0.01 mm by default) and ends closed paths exactly on their start, and `stockOffset`, `stockBox` and `stockBounds`, which convert between stock and work coordinates.

- [#36](https://github.com/federicovezzoli/furrow-cam/pull/36) [`a09198a`](https://github.com/federicovezzoli/furrow-cam/commit/a09198acf6c2e5c9e97dda94527e198321cd7e58) Thanks [@federicovezzoli](https://github.com/federicovezzoli)! - Add the workspace shell at `/projects/[id]`: a full-window layout with a top bar (project name, save state, export, theme toggle) over resizable panels for geometry and operations, the viewport and properties. Side panels can be collapsed, panel sizes are remembered between visits, and narrow windows scroll sideways instead of clipping panels. Add compact density tokens (`h-control`, `text-ui`) and compact button sizes for the workspace, and light/dark themes that follow the system setting with a manual toggle. The site navbar now spans the full width.

- [#38](https://github.com/federicovezzoli/furrow-cam/pull/38) [`b7e2fc3`](https://github.com/federicovezzoli/furrow-cam/commit/b7e2fc3f35629815cdbe14ffed21b6312242a81d) Thanks [@federicovezzoli](https://github.com/federicovezzoli)! - Add the workspace's client state (ADR-0010): document, workspace and toolpath stores created per open project, undo/redo of document changes through Immer patches with transactions that turn a continuous gesture into one undo step, Ctrl/Cmd+Z and Ctrl/Cmd+Shift+Z shortcuts (text fields, dialogs and menus keep the keys), and autosave of the document one second after the last change, never mid-gesture. Changes made while a save is running are saved after it, including when leaving the workspace, and undoing back to the saved state counts as saved. The top bar's save indicator follows autosave; if the server refuses a save (for example because the project was changed elsewhere), autosave stops and a banner explains why. Exporting from the workspace downloads the document as it is on screen, unsaved changes included. Leaving the page with unsaved changes asks for confirmation.

- [#63](https://github.com/federicovezzoli/furrow-cam/pull/63) [`2f38be9`](https://github.com/federicovezzoli/furrow-cam/commit/2f38be9c783cbb090a052221907fe432b514a7c5) Thanks [@federicovezzoli](https://github.com/federicovezzoli)! - Pick the XY zero in the viewport (PRD-0002 Z5, Z9). With a custom zero, **Pick in viewport** in the stock properties switches to the top view and enters pick mode (crosshair cursor; Esc or a right-click without dragging cancels). The cursor snaps within 10 pixels to the 9 stock anchors, shape vertices, arc centres, circle centres (closed paths drilling takes as circles, drawn as arcs, polygons or Béziers) and shape bounding-box corners and centres; the target is ringed and labelled with its kind and its X/Y from the stock's bottom-left corner in project units. Clicking puts the zero where shown, as one undo step, and leaves pick mode: on the anchor itself for a stock anchor, so it follows the stock when resized, otherwise on a custom zero (at the cursor where nothing is in reach). The snap follows the camera as it pans and zooms under a still cursor, and pick mode ends when the zero stops being custom (an undo, an anchor chosen). `@furrow/cam-core` adds `snapTargets`, `nearestSnapTarget` and `circleCenter`.

- [#62](https://github.com/federicovezzoli/furrow-cam/pull/62) [`4565602`](https://github.com/federicovezzoli/furrow-cam/commit/456560227eaf9d89c23ad1093b6a86fa8aebfb88) Thanks [@federicovezzoli](https://github.com/federicovezzoli)! - Zero picker in the stock properties (PRD-0002 Z2, Z4, Z9, Z10): a 3×3 grid puts the XY zero on any stock anchor (radio group, arrow keys move around the grid as laid out and on to Custom below it), **Custom** reveals unit-aware X and Y fields measured from the stock's bottom-left corner and pre-filled with the current zero so it doesn't jump, and a selector chooses the Z zero (stock top or machine bed). Each change is one undo step.

- [#59](https://github.com/federicovezzoli/furrow-cam/pull/59) [`1b80f39`](https://github.com/federicovezzoli/furrow-cam/commit/1b80f394baf70e2a915c0f8cae6976943350c5ee) Thanks [@federicovezzoli](https://github.com/federicovezzoli)! - Zero point model (ADR-0016). The stock's `xyOrigin` is now `{ anchor }`, with one of 9 stock anchors (`StockAnchor`: corners, edge midpoints and centre), or `{ anchor: "custom", x, y }` in millimetres from the stock's bottom-left corner, which may lie outside the stock. Documents with the old `"bottom_left"` and `"center"` strings still load and are normalised. `stockOffset` and `stockBounds` handle every anchor and custom zeros, anchors following the stock when it is resized; `@furrow/cam-core` adds `xyOriginPosition`, and `stockBox` needs only the stock's size. The viewport's origin marker follows the zero; the grid reaches it when it lies outside the stock (getting coarser past 1000 lines per axis), and Fit frames it too.

### Patch Changes

- [#58](https://github.com/federicovezzoli/furrow-cam/pull/58) [`802882c`](https://github.com/federicovezzoli/furrow-cam/commit/802882c3f951a58c4fe673efc0309999640fee98) Thanks [@federicovezzoli](https://github.com/federicovezzoli)! - Generate the Prisma client in `vercel-build`, so deployments from a cached install no longer fail to resolve it.
- Updated dependencies [[`bca37a9`](https://github.com/federicovezzoli/furrow-cam/commit/bca37a99f77a889384ad5d3dddc8f2c34bf5b0ba), [`8cb9e68`](https://github.com/federicovezzoli/furrow-cam/commit/8cb9e684948872e7391d6bdc7a8bdaf37805c38f), [`921cb07`](https://github.com/federicovezzoli/furrow-cam/commit/921cb07a6c9de23107e0f5457734e1441fb35e6b), [`99a60af`](https://github.com/federicovezzoli/furrow-cam/commit/99a60af86f8f8226b1f8ba76bea17afb5eb9c49d), [`51e0cd4`](https://github.com/federicovezzoli/furrow-cam/commit/51e0cd4d95c71d9f74ca428a336627cf7ed54919), [`52e3b3a`](https://github.com/federicovezzoli/furrow-cam/commit/52e3b3a411ef391b712c84e394480e4ad17d1aa4), [`a38cae2`](https://github.com/federicovezzoli/furrow-cam/commit/a38cae2ad90e497d267d523e9f474b588d08d9f0), [`ea50706`](https://github.com/federicovezzoli/furrow-cam/commit/ea507062530f1c671e7d798df4c339d6dfed6114), [`a38cae2`](https://github.com/federicovezzoli/furrow-cam/commit/a38cae2ad90e497d267d523e9f474b588d08d9f0), [`4ef3212`](https://github.com/federicovezzoli/furrow-cam/commit/4ef3212b7d2e39e4464c5450a004a94af041548d), [`d3c98e7`](https://github.com/federicovezzoli/furrow-cam/commit/d3c98e7dabf99a1fad1bc592f4050ca9fdf873eb), [`294f207`](https://github.com/federicovezzoli/furrow-cam/commit/294f2074bdb2374344af654ed20d52b74b3ed395), [`6c780c9`](https://github.com/federicovezzoli/furrow-cam/commit/6c780c9a782ecc3c4d79e17e726ddfe3659a1499), [`bbf6532`](https://github.com/federicovezzoli/furrow-cam/commit/bbf6532bc09ba1c6c1d73da613fb598d621b7e4f), [`0b8091c`](https://github.com/federicovezzoli/furrow-cam/commit/0b8091cc4b790b975be145d1376d5087a770538d), [`2f38be9`](https://github.com/federicovezzoli/furrow-cam/commit/2f38be9c783cbb090a052221907fe432b514a7c5), [`1b80f39`](https://github.com/federicovezzoli/furrow-cam/commit/1b80f394baf70e2a915c0f8cae6976943350c5ee)]:
  - @furrow/document@0.2.0
  - @furrow/cam-core@0.2.0
  - @furrow/post@0.2.0

## 0.2.0

### Minor Changes

- [`8a216ca`](https://github.com/federicovezzoli/furrow-cam/commit/8a216ca33f3310d54db1d8236c435f7a870b6e06) Thanks [@federicovezzoli](https://github.com/federicovezzoli)! - Initial monorepo scaffold: Next.js app, project document schema, unit helpers and empty post-processor package.

### Patch Changes

- Updated dependencies [[`8a216ca`](https://github.com/federicovezzoli/furrow-cam/commit/8a216ca33f3310d54db1d8236c435f7a870b6e06)]:
  - @furrow/document@0.1.0
  - @furrow/cam-core@0.1.0
  - @furrow/post@0.1.0
