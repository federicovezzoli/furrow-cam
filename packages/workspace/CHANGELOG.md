# @furrow/workspace

## 0.12.2

### Patch Changes

- Updated dependencies: @furrow/ui@0.3.3

## 0.12.1

### Patch Changes

- Furrow CAM has the logo and colours of furrow.cam: an F as a round end mill would carve it, for the favicons, the installable web app and the desktop app icon, and warm paper greys with an orange focus ring throughout the app. Panels floating over the 3D view blur what lies behind them. ([`033a756`](https://github.com/federicovezzoli/furrow-cam/commit/033a756b90c6014de4ab969143c415999782d157))
- The workspace sidebar now shows Operations and Properties as two tabs, so the project's properties are always one click away. Importing another drawing and the project's versions moved to labelled buttons in the top bar. ([`242d067`](https://github.com/federicovezzoli/furrow-cam/commit/242d0679471253336e346841a3d8ec852498ed59))
- Updated dependencies: @furrow/ui@0.3.2

## 0.12.0

### Minor Changes

- Operations are reordered by dragging the handle at the start of their row, or with ↑ and ↓ while the handle is focused, instead of with up and down arrow buttons. ([#343](https://github.com/federicovezzoli/furrow-cam/pull/343))

### Patch Changes

- The Versions pane now says why when the list of versions can't be loaded, instead of showing "Loading versions…" forever. ([#341](https://github.com/federicovezzoli/furrow-cam/pull/341))
- Updated dependencies: @furrow/ui@0.3.1, @furrow/document@0.13.1, @furrow/cam-core@0.12.1, @furrow/post@0.10.1

## 0.11.0

### Minor Changes

- You can duplicate a drawing from its properties. The copy lands 10 mm to its right and is selected, ready to move; it is machined by the same operations, with the same profile tabs. ([#336](https://github.com/federicovezzoli/furrow-cam/pull/336))
- Errors, confirmations and renames now open in an in-app dialog that matches the theme, instead of the browser's own alert, confirm and prompt boxes. ([#338](https://github.com/federicovezzoli/furrow-cam/pull/338))
- The step-over is now set on each pocket, drill, V-carve flat bottom and 3D roughing operation instead of on the bit, so operations with the same bit can use different step-overs. Existing projects keep the step-over their bits had. ([#335](https://github.com/federicovezzoli/furrow-cam/pull/335))
- While toolpaths compute, a toast in the viewport's bottom left corner shows the operation computing now, its progress and how many are done, with a button to cancel it. The operation's properties also show its progress as a percentage. ([#337](https://github.com/federicovezzoli/furrow-cam/pull/337))
- With a touch-off pad, the tool-change field now always shows the block that runs at each tool change, derived from the machine's unless you edit it, and **Reset** goes back to that block. Exported programs follow it: a machine tool change that moves now has its move put on the pad, and the default pause no longer names the bit, since the comment just before it already does. ([#320](https://github.com/federicovezzoli/furrow-cam/pull/320))

### Patch Changes

- Error messages from saving, importing and managing projects, tools, machines and 3D models are now shown in the language the page is displayed in. ([#331](https://github.com/federicovezzoli/furrow-cam/pull/331))
- Saving changes to a machine now keeps you on its page with a confirmation, and open projects pick up the new settings without reloading the page. ([#322](https://github.com/federicovezzoli/furrow-cam/pull/322))
- Updated dependencies: @furrow/ui@0.3.0, @furrow/document@0.13.0, @furrow/cam-core@0.12.0, @furrow/post@0.10.0

## 0.10.0

### Minor Changes

- Clicking a drawing's shape now also shows the drawing's properties over the viewport, where you can set its width or height (it keeps its proportions), fit it to the stock with a border, or remove it. Profile tabs placed on its paths move with it. A new drawing now lands its border in from the zero's anchor. The selected drawing is shaded in the viewport, and selected paths have a faint outline so they stand out on the stock. ([#316](https://github.com/federicovezzoli/furrow-cam/pull/316))
- You can move a drawing: drag it in the top view, or set its X and Y position from the zero in its properties. Profile tabs on its paths move with it. Its properties warn when part of it lies outside the stock, and its border is now the margin Fit to stock leaves, set next to that button. ([#317](https://github.com/federicovezzoli/furrow-cam/pull/317))
- You can mirror a drawing left to right or top to bottom, and turn it by 90° steps or by any angle, from its properties. It stays in place at the zero's anchor, and profile tabs on its paths turn with it. ([#318](https://github.com/federicovezzoli/furrow-cam/pull/318))
- A project can now hold several drawings: each SVG or DXF file you import is added as its own drawing, aligned to the stock at the XY zero. A project holds drawings or one STL model, not both. Existing projects open with their shapes as one drawing. ([#315](https://github.com/federicovezzoli/furrow-cam/pull/315))

### Patch Changes

- Dragging or scrubbing a value keeps one undo step's worth of memory, however long the gesture, instead of a copy per pointer move. ([#317](https://github.com/federicovezzoli/furrow-cam/pull/317))
- Updated dependencies: @furrow/cam-core@0.11.0, @furrow/document@0.12.0, @furrow/post@0.9.1, @furrow/ui@0.2.1

## 0.9.0

### Minor Changes

- Toolpath and import warnings, file errors, export messages and form validation now appear in English, Italian, French or German. ([#305](https://github.com/federicovezzoli/furrow-cam/pull/305))
- Furrow CAM starts in your browser's or system's language when it's English, Italian, French or German, and a new language button next to the theme toggle lets you pick another. Only a few labels are translated so far; the rest follows in upcoming releases. ([#301](https://github.com/federicovezzoli/furrow-cam/pull/301))
- The CAM workspace, including its operations, bit and machine forms, machine presets, simulator and guided tour, now appears in English, Italian, French or German. In Italian, French and German, number fields also accept a comma as the decimal point. ([#306](https://github.com/federicovezzoli/furrow-cam/pull/306))

### Patch Changes

- Updated dependencies: @furrow/document@0.11.0, @furrow/cam-core@0.10.0, @furrow/post@0.9.0, @furrow/ui@0.2.0

## 0.8.0

### Minor Changes

- A model's border is now editable next to **Fit to stock** (10 mm by default, 0 to fit edge to edge), and the Position fields say more clearly that they move the model rather than set the border. ([#272](https://github.com/federicovezzoli/furrow-cam/pull/272))

### Patch Changes

- Updated dependencies: @furrow/document@0.10.0, @furrow/cam-core@0.9.0, @furrow/post@0.8.2, @furrow/ui@0.1.6

## 0.7.0

### Minor Changes

- Anonymous usage statistics and error reports with PostHog replace GoatCounter page-view counts: no cookies, nothing linked to your account, and no projects, file names or drawings sent. The desktop app asks first and can be switched off in the Help menu. ([#285](https://github.com/federicovezzoli/furrow-cam/pull/285))
- Report a bug from the workspace's top bar, the footer or the desktop app's Help menu: it opens a GitHub issue filled in with your description and diagnostics you can review first, plus a screenshot of the viewport to paste into it. ([#282](https://github.com/federicovezzoli/furrow-cam/pull/282))

### Patch Changes

- Custom G-code blocks, the machine's and a touch-off pad's tool change, can now use `{safeZ}`, and **Suggest** rises to it, so the exported program retracts to the machine's current safe Z instead of the one set when Suggest was clicked. If you clicked Suggest before this release, click it again to pick this up. A placeholder the post can't fill in, such as a misspelt `{safez}`, now warns at export. ([#269](https://github.com/federicovezzoli/furrow-cam/pull/269))
- Updated dependencies: @furrow/post@0.8.1

## 0.6.0

### Minor Changes

- G-code now waits for the spindle to reach speed (`G4`) after starting it or raising its speed, before the bit moves. Machine profiles have a spin-up delay, 5 seconds by default, for existing machines and projects too; a manual spindle, switched on by hand, gets no wait. ([#264](https://github.com/federicovezzoli/furrow-cam/pull/264))

### Patch Changes

- Autosave no longer stops for the rest of the session after a refusal you can fix, such as being signed out, an edit the project can't store, or a model whose file isn't uploaded: it saves again with the next change, or when you come back to the window. A conflict with a save made elsewhere still stops it. ([#266](https://github.com/federicovezzoli/furrow-cam/pull/266))
- Profiles, pockets and 3D roughing and finishing no longer take drill bits, which snap when moved sideways through the stock: the tool picker disables them, and new operations start with a bit that cuts sideways. A project saved with a drill bit on one of these operations still opens; the operation shows why it has no toolpath until you pick another bit, and G-code export refuses the project rather than leaving that operation out. ([#262](https://github.com/federicovezzoli/furrow-cam/pull/262))
- Editing the project while its G-code is being exported no longer downloads the program of the project as it was when you clicked Export: the export starts again and downloads what the screen shows. If the project keeps changing, the export stops and asks you to export again once you're done editing. ([#265](https://github.com/federicovezzoli/furrow-cam/pull/265))
- Leaving a project with changes that can't be saved, through All projects, another in-app link or the browser's Back button, now asks first instead of dropping them. ([#267](https://github.com/federicovezzoli/furrow-cam/pull/267))
- Updated dependencies: @furrow/document@0.9.0, @furrow/cam-core@0.8.4, @furrow/post@0.8.0, @furrow/ui@0.1.5

## 0.5.1

### Patch Changes

- Updated dependencies: @furrow/cam-core@0.8.3, @furrow/post@0.7.3, @furrow/ui@0.1.4

## 0.5.0

### Minor Changes

- Without an account, projects now have their own addresses (`/projects/…`) like an account's, you can add and edit your own bits, and `/new` opens a new project straight in the workspace. The project list mentions the desktop app as a way to keep your work. ([#237](https://github.com/federicovezzoli/furrow-cam/pull/237))

## 0.4.0

### Minor Changes

- Operations can now use common bits from a built-in catalog (flat end mills in metric and imperial sizes, ball nose and V-bits), with cautious feeds for softwood and plywood. Editing a catalog bit saves your own copy to your library. ([#230](https://github.com/federicovezzoli/furrow-cam/pull/230))
- Without an account, exporting G-code, setting up a machine or saving your own bits now explains what they need, with a free account, the desktop app for your system, or the project saved as a file. ([#232](https://github.com/federicovezzoli/furrow-cam/pull/232))
- You can use Furrow CAM without an account: app.furrow.cam opens the workspace straight away, and your projects are kept in your browser until you sign up. ([#231](https://github.com/federicovezzoli/furrow-cam/pull/231))

### Patch Changes

- You can create and import projects before adding a machine, and choose the machine in the project when you're ready to export G-code. ([#228](https://github.com/federicovezzoli/furrow-cam/pull/228))
- Updated dependencies: @furrow/document@0.8.0, @furrow/cam-core@0.8.2, @furrow/post@0.7.2, @furrow/ui@0.1.3

## 0.3.0

### Minor Changes

- The desktop app now remembers the workspace's panel sizes and collapsed panes between projects and launches, as the web app does. ([#207](https://github.com/federicovezzoli/furrow-cam/pull/207))

### Patch Changes

- Updated dependencies: @furrow/document@0.7.1, @furrow/cam-core@0.8.1, @furrow/post@0.7.1, @furrow/ui@0.1.2

## 0.2.0

### Minor Changes

- A desktop app for macOS, Windows and Linux that works offline with no account: projects are saved as `.furrow` files with their versions, unsaved changes are offered back after a crash, and the bits library and machines are kept on the computer. ([#195](https://github.com/federicovezzoli/furrow-cam/pull/195))

### Patch Changes

- Updated dependencies: @furrow/ui@0.1.1, @furrow/document@0.7.0, @furrow/cam-core@0.8.0, @furrow/post@0.7.0
