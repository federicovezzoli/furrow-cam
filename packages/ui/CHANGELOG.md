# @furrow/ui

## 0.3.5

### Patch Changes

- Profiles, pockets, drilling, engraving and V-carving can cut the bottom side of a two-sided project, on the drawing as seen from below, and export with the bottom side's G-code. ([#380](https://github.com/federicovezzoli/furrow-cam/pull/380))
- *Convert to drawing* turns a text item into a plain drawing that keeps its letters and the operations that machine them, but can no longer be edited as text. ([#384](https://github.com/federicovezzoli/furrow-cam/pull/384))
- Upload your own TTF, OTF or WOFF font into a project from the text panel, marking it single-stroke for engraving if it is, and use it for any text in the project. ([#389](https://github.com/federicovezzoli/furrow-cam/pull/389))
- Updated dependencies: @furrow/cam-core@0.14.0, @furrow/document@0.15.0

## 0.3.4

### Patch Changes

- A two-sided project exports one G-code file per side, such as `Owl-top.gcode` and `Owl-bottom.gcode`, and each file's header says when to turn the stock over and how to zero it. ([#378](https://github.com/federicovezzoli/furrow-cam/pull/378))
- Updated dependencies: @furrow/cam-core@0.13.0, @furrow/document@0.14.0

## 0.3.3

### Patch Changes

- The app's header shows the Furrow CAM logo next to its name, as furrow.cam does. ([`cb8445f`](https://github.com/federicovezzoli/furrow-cam/commit/cb8445fb1c3da097e01cfd06b2d55f446180ba10))

## 0.3.2

### Patch Changes

- Furrow CAM has the logo and colours of furrow.cam: an F as a round end mill would carve it, for the favicons, the installable web app and the desktop app icon, and warm paper greys with an orange focus ring throughout the app. Panels floating over the 3D view blur what lies behind them. ([`033a756`](https://github.com/federicovezzoli/furrow-cam/commit/033a756b90c6014de4ab969143c415999782d157))
- The workspace sidebar now shows Operations and Properties as two tabs, so the project's properties are always one click away. Importing another drawing and the project's versions moved to labelled buttons in the top bar. ([`242d067`](https://github.com/federicovezzoli/furrow-cam/commit/242d0679471253336e346841a3d8ec852498ed59))

## 0.3.1

### Patch Changes

- Operations are reordered by dragging the handle at the start of their row, or with ↑ and ↓ while the handle is focused, instead of with up and down arrow buttons. ([#343](https://github.com/federicovezzoli/furrow-cam/pull/343))
- The Versions pane now says why when the list of versions can't be loaded, instead of showing "Loading versions…" forever. ([#341](https://github.com/federicovezzoli/furrow-cam/pull/341))
- Updated dependencies: @furrow/document@0.13.1, @furrow/cam-core@0.12.1

## 0.3.0

### Minor Changes

- Errors, confirmations and renames now open in an in-app dialog that matches the theme, instead of the browser's own alert, confirm and prompt boxes. ([#338](https://github.com/federicovezzoli/furrow-cam/pull/338))

### Patch Changes

- Error messages from saving, importing and managing projects, tools, machines and 3D models are now shown in the language the page is displayed in. ([#331](https://github.com/federicovezzoli/furrow-cam/pull/331))
- You can duplicate a drawing from its properties. The copy lands 10 mm to its right and is selected, ready to move; it is machined by the same operations, with the same profile tabs. ([#336](https://github.com/federicovezzoli/furrow-cam/pull/336))
- The step-over is now set on each pocket, drill, V-carve flat bottom and 3D roughing operation instead of on the bit, so operations with the same bit can use different step-overs. Existing projects keep the step-over their bits had. ([#335](https://github.com/federicovezzoli/furrow-cam/pull/335))
- While toolpaths compute, a toast in the viewport's bottom left corner shows the operation computing now, its progress and how many are done, with a button to cancel it. The operation's properties also show its progress as a percentage. ([#337](https://github.com/federicovezzoli/furrow-cam/pull/337))
- With a touch-off pad, the tool-change field now always shows the block that runs at each tool change, derived from the machine's unless you edit it, and **Reset** goes back to that block. Exported programs follow it: a machine tool change that moves now has its move put on the pad, and the default pause no longer names the bit, since the comment just before it already does. ([#320](https://github.com/federicovezzoli/furrow-cam/pull/320))
- Updated dependencies: @furrow/document@0.13.0, @furrow/cam-core@0.12.0

## 0.2.1

### Patch Changes

- Updated dependencies: @furrow/cam-core@0.11.0, @furrow/document@0.12.0

## 0.2.0

### Minor Changes

- Toolpath and import warnings, file errors, export messages and form validation now appear in English, Italian, French or German. ([#305](https://github.com/federicovezzoli/furrow-cam/pull/305))
- Furrow CAM starts in your browser's or system's language when it's English, Italian, French or German, and a new language button next to the theme toggle lets you pick another. Only a few labels are translated so far; the rest follows in upcoming releases. ([#301](https://github.com/federicovezzoli/furrow-cam/pull/301))
- The CAM workspace, including its operations, bit and machine forms, machine presets, simulator and guided tour, now appears in English, Italian, French or German. In Italian, French and German, number fields also accept a comma as the decimal point. ([#306](https://github.com/federicovezzoli/furrow-cam/pull/306))

### Patch Changes

- Export now reads back the machine's custom G-code blocks and warns, with the line number, when one moves the tool into material or below the stock bottom, or when it can't be followed (e.g. `G53`) and the rest of the program isn't checked. ([#291](https://github.com/federicovezzoli/furrow-cam/pull/291))
- The web app's pages, forms, messages and errors now appear in English, Italian, French or German, and dates and numbers follow the chosen language. The privacy policy stays in English, with a note saying so. ([#304](https://github.com/federicovezzoli/furrow-cam/pull/304))
- Updated dependencies: @furrow/document@0.11.0, @furrow/cam-core@0.10.0

## 0.1.6

### Patch Changes

- Updated dependencies: @furrow/document@0.10.0, @furrow/cam-core@0.9.0

## 0.1.5

### Patch Changes

- Updated dependencies: @furrow/document@0.9.0, @furrow/cam-core@0.8.4

## 0.1.4

### Patch Changes

- Updated dependencies: @furrow/cam-core@0.8.3

## 0.1.3

### Patch Changes

- Updated dependencies: @furrow/document@0.8.0, @furrow/cam-core@0.8.2

## 0.1.2

### Patch Changes

- Updated dependencies: @furrow/document@0.7.1, @furrow/cam-core@0.8.1

## 0.1.1

### Patch Changes

- A desktop app for macOS, Windows and Linux that works offline with no account: projects are saved as `.furrow` files with their versions, unsaved changes are offered back after a crash, and the bits library and machines are kept on the computer. ([#195](https://github.com/federicovezzoli/furrow-cam/pull/195))
- Updated dependencies: @furrow/document@0.7.0, @furrow/cam-core@0.8.0
