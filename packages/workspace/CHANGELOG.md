# @furrow/workspace

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
