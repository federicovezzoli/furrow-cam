# @furrow/desktop

## 0.12.0

### Minor Changes

- Furrow CAM is now also available in Spanish, Dutch, Portuguese, Greek, Turkish, Chinese and Japanese. It picks the language from your browser or system, or you can choose one with the language button. ([#421](https://github.com/federicovezzoli/furrow-cam/pull/421))

### Patch Changes

- Add a local MCP server through which an AI assistant can create, open, summarise and save Furrow CAM projects on your computer. Before its first change to a project, the project is kept as a version you can restore. ([#415](https://github.com/federicovezzoli/furrow-cam/pull/415))

## 0.11.1

### Patch Changes

- Opening a project no longer logs a `THREE.Clock` deprecation warning in the browser console. ([#407](https://github.com/federicovezzoli/furrow-cam/pull/407))

## 0.11.0

### Minor Changes

- Projects can now hold uploaded fonts as files of their own, stored, exported and imported with the project like 3D models, in the web app, for guests and in the desktop app. Projects saved by this release can't be opened by older ones. ([#388](https://github.com/federicovezzoli/furrow-cam/pull/388))

## 0.10.2

### Patch Changes

- The app's header shows the Furrow CAM logo next to its name, as furrow.cam does. ([`cb8445f`](https://github.com/federicovezzoli/furrow-cam/commit/cb8445fb1c3da097e01cfd06b2d55f446180ba10))
- The navbar highlights the section you are in. ([`91e4026`](https://github.com/federicovezzoli/furrow-cam/commit/91e40261c4a304314cbdeb271e71b97a5e36ed3d))

## 0.10.1

### Patch Changes

- Furrow CAM has the logo and colours of furrow.cam: an F as a round end mill would carve it, for the favicons, the installable web app and the desktop app icon, and warm paper greys with an orange focus ring throughout the app. Panels floating over the 3D view blur what lies behind them. ([`033a756`](https://github.com/federicovezzoli/furrow-cam/commit/033a756b90c6014de4ab969143c415999782d157))

## 0.10.0

### Minor Changes

- Errors, confirmations and renames now open in an in-app dialog that matches the theme, instead of the browser's own alert, confirm and prompt boxes. ([#338](https://github.com/federicovezzoli/furrow-cam/pull/338))

### Patch Changes

- The step-over is now set on each pocket, drill, V-carve flat bottom and 3D roughing operation instead of on the bit, so operations with the same bit can use different step-overs. Existing projects keep the step-over their bits had. ([#335](https://github.com/federicovezzoli/furrow-cam/pull/335))

## 0.9.0

### Minor Changes

- The desktop app's menus, dialogs, start screen and library pages are now in English, Italian, French or German, and the menus switch language as soon as you pick another one. ([#303](https://github.com/federicovezzoli/furrow-cam/pull/303))
- Furrow CAM starts in your browser's or system's language when it's English, Italian, French or German, and a new language button next to the theme toggle lets you pick another. Only a few labels are translated so far; the rest follows in upcoming releases. ([#301](https://github.com/federicovezzoli/furrow-cam/pull/301))

### Patch Changes

- Toolpath and import warnings, file errors, export messages and form validation now appear in English, Italian, French or German. ([#305](https://github.com/federicovezzoli/furrow-cam/pull/305))
- A project or saved version that can't be upgraded to this release now says why when opened in the desktop app or from a `.furrow` archive, as it already did on the web. ([#289](https://github.com/federicovezzoli/furrow-cam/pull/289))
- The CAM workspace, including its operations, bit and machine forms, machine presets, simulator and guided tour, now appears in English, Italian, French or German. In Italian, French and German, number fields also accept a comma as the decimal point. ([#306](https://github.com/federicovezzoli/furrow-cam/pull/306))

## 0.8.0

### Minor Changes

- A model's border is now editable next to **Fit to stock** (10 mm by default, 0 to fit edge to edge), and the Position fields say more clearly that they move the model rather than set the border. ([#272](https://github.com/federicovezzoli/furrow-cam/pull/272))

## 0.7.0

### Minor Changes

- Anonymous usage statistics and error reports with PostHog replace GoatCounter page-view counts: no cookies, nothing linked to your account, and no projects, file names or drawings sent. The desktop app asks first and can be switched off in the Help menu. ([#285](https://github.com/federicovezzoli/furrow-cam/pull/285))
- Report a bug from the workspace's top bar, the footer or the desktop app's Help menu: it opens a GitHub issue filled in with your description and diagnostics you can review first, plus a screenshot of the viewport to paste into it. ([#282](https://github.com/federicovezzoli/furrow-cam/pull/282))

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
