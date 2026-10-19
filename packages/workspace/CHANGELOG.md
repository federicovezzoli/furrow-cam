# @furrow/workspace

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
