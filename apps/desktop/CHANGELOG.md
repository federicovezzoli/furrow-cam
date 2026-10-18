# @furrow/desktop

## 0.2.1

### Patch Changes

- The desktop app, its installers and its `.furrow` files now show the Furrow CAM icon instead of Electron's. ([#208](https://github.com/federicovezzoli/furrow-cam/pull/208))
- The desktop app now opens in the dark theme straight away when that's the chosen or system theme, without a light frame first. ([#205](https://github.com/federicovezzoli/furrow-cam/pull/205))
- The desktop app now remembers the workspace's panel sizes and collapsed panes between projects and launches, as the web app does. ([#207](https://github.com/federicovezzoli/furrow-cam/pull/207))

## 0.2.0

### Minor Changes

- A desktop app for macOS, Windows and Linux that works offline with no account: projects are saved as `.furrow` files with their versions, unsaved changes are offered back after a crash, and the bits library and machines are kept on the computer. ([#195](https://github.com/federicovezzoli/furrow-cam/pull/195))
