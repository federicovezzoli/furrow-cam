# @furrow/desktop

## 0.6.0

### Minor Changes

- G-code now waits for the spindle to reach speed (`G4`) after starting it or raising its speed, before the bit moves. Machine profiles have a spin-up delay, 5 seconds by default, for existing machines and projects too; a manual spindle, switched on by hand, gets no wait. ([#264](https://github.com/federicovezzoli/furrow-cam/pull/264))

## 0.5.0

### Minor Changes

- The desktop app now comes as a pacman package for Arch Linux, at `download.furrow.cam/linux-pacman`. It adds Furrow CAM to the app launcher and opens `.furrow` files. ([#248](https://github.com/federicovezzoli/furrow-cam/pull/248))

## 0.4.0

### Minor Changes

- Operations can now use common bits from a built-in catalog (flat end mills in metric and imperial sizes, ball nose and V-bits), with cautious feeds for softwood and plywood. Editing a catalog bit saves your own copy to your library. ([#230](https://github.com/federicovezzoli/furrow-cam/pull/230))

## 0.3.0

### Minor Changes

- The desktop app can tell you when a new version is released: it asks on first start whether to check at start-up, and Help → Check for Updates… checks at any time. It links to the download page; nothing is installed automatically. ([#215](https://github.com/federicovezzoli/furrow-cam/pull/215))

### Patch Changes

- The Furrow CAM logo is now a toolpath tracing the outline of an F, used for the favicons, the installable web app and the desktop app icon. ([`033a756`](https://github.com/federicovezzoli/furrow-cam/commit/033a756b90c6014de4ab969143c415999782d157))
- The macOS app no longer fails to open as "damaged" after downloading it; macOS now shows its usual warning for apps from unidentified developers, which **Open Anyway** in Privacy & Security gets past. ([#214](https://github.com/federicovezzoli/furrow-cam/pull/214))

## 0.2.1

### Patch Changes

- The desktop app, its installers and its `.furrow` files now show the Furrow CAM icon instead of Electron's. ([#208](https://github.com/federicovezzoli/furrow-cam/pull/208))
- The desktop app now opens in the dark theme straight away when that's the chosen or system theme, without a light frame first. ([#205](https://github.com/federicovezzoli/furrow-cam/pull/205))
- The desktop app now remembers the workspace's panel sizes and collapsed panes between projects and launches, as the web app does. ([#207](https://github.com/federicovezzoli/furrow-cam/pull/207))

## 0.2.0

### Minor Changes

- A desktop app for macOS, Windows and Linux that works offline with no account: projects are saved as `.furrow` files with their versions, unsaved changes are offered back after a crash, and the bits library and machines are kept on the computer. ([#195](https://github.com/federicovezzoli/furrow-cam/pull/195))
