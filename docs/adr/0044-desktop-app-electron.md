# ADR-0044: The desktop app is an Electron shell around the shared workspace

- **Status:** Proposed
- **Date:** 2026-10-18
- **Deciders:** Federico Vezzoli
- **Related:** PRD-0007, ADR-0002, ADR-0004, ADR-0008, ADR-0012, ADR-0013, ADR-0045, ADR-0046, ADR-0047; #184

## Context

PRD-0007 asks for a desktop application that works with no account and no connection, and keeps projects as files on the user's disk.

All CAM work already runs in the browser, in module Web Workers (ADR-0004), with no WASM and no `SharedArrayBuffer`. The server only authenticates and stores. The viewport, the heightmap simulation and relief previews are heavy WebGL through three.js (ADR-0008, ADR-0019), developed and tested in Chromium.

The web app is built on Next.js (ADR-0002) with server actions, `cookies()`, `proxy.ts` and `cacheComponents`. None of these work in a static export, and a desktop shell loads static files.

## Options considered

**Shell**

1. **Tauri.** Installers of about 10–15 MB, low memory use. It renders with the system webview: WebView2 (Chromium) on Windows, WKWebView on macOS, WebKitGTK on Linux. WebGL in WebKitGTK is known to fall back to software rendering or a blank canvas on some GPU and Wayland setups, and every viewport bug would need checking in WebKit too.
2. **Electron.** Ships Chromium, so rendering, WebGL and workers behave as in Chrome on every platform. Installers of about 100 MB and higher memory use.
3. **An installable offline web app (PWA).** No installer at all. Writing to real files needs the File System Access API, which only Chromium browsers have.

**Renderer build**

1. **Next.js static export of the web app.** Needs a parallel route tree without server code and conditional builds of every route, against how Next.js is designed.
2. **A separate Vite app** that mounts the shared workspace (ADR-0046) with a desktop storage implementation (ADR-0045).

## Decision

We will use option 2 for both: **Electron**, and a separate **`apps/desktop`** built with Vite.

- **Processes.** The renderer is the React app: a start screen (New, Open, recent files) and the shared workspace. The main process owns windows, menus, file dialogs and all file access. A preload script exposes a small typed API through `contextBridge`. The renderer runs with `contextIsolation`, `sandbox` and no `nodeIntegration`.
- **Loading.** The renderer's static files are served from a custom `app://` protocol registered as standard and secure, so module workers and `import.meta.url` resolve as on the web. Navigation away from the app is blocked, and links to the docs or the website open in the system browser.
- **No network.** The app makes no requests. A Content Security Policy with no `connect-src` beyond the app enforces it. Auth, email, S3, usage limits (ADR-0017), analytics (ADR-0020), the guided tour's server state (ADR-0036) and the privacy page are not part of the desktop app.
- **Build tooling.** `electron-vite` builds the main, preload and renderer bundles. `electron-builder` packages them.
- **Distribution.** On a release tag, CI builds on macOS, Windows and Linux runners and attaches unsigned installers to the GitHub Release: `.dmg` (Apple Silicon and Intel), `.exe` (NSIS), `.AppImage` and `.deb`. There is no code signing and no auto-updater; users download new versions themselves. The download page explains the first-launch warnings (Gatekeeper on macOS, SmartScreen on Windows).
- **Versioning.** `apps/desktop` is a private workspace package versioned by Changesets like the others (ADR-0012). The desktop release is built from the same `main` as the web release.

## Consequences

- The viewport and simulation behave the same in the browser and the desktop app; one engine to test.
- Installers are about 100 MB, which we accept for an application downloaded once.
- The desktop app collects no personal data. ADR-0003, ADR-0006 and ADR-0013 apply only to the web app.
- Unsigned installers trigger operating-system warnings on first launch. Signing can be added later without changing this design.
- Without an updater, users may run old versions. Files carry their `schemaVersion`, so an older app refuses a newer file rather than misreading it.
- Follow-up: a release workflow in `.github/workflows/`, and the layout in `AGENTS.md` gains `apps/desktop`.
