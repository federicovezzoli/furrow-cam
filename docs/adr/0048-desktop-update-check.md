# ADR-0048: The desktop app checks GitHub for newer versions and links to them

- **Status:** Proposed
- **Date:** 2026-10-18
- **Deciders:** Federico Vezzoli
- **Related:** PRD-0007, ADR-0012, ADR-0013, ADR-0044; #201, #212

## Context

ADR-0044 ships the desktop app without an updater, and PRD-0007 D2 says it makes no network requests. Users only learn about a new version by going back to the releases page, so many keep running old ones.

Installing updates automatically has hard limits here:

- `electron-updater` installs on macOS through Squirrel.Mac, which refuses an unsigned app. Our installers are unsigned (ADR-0044).
- A `.deb` can't update itself; the system's package manager does that.
- The repository has one GitHub Release per package (ADR-0012), so the newest release is usually another package's (`@furrow/web@…`). `electron-updater`'s GitHub provider expects the newest release to be the app's.

Any check sends a request, and with it the user's IP address, to whoever answers it (ADR-0013).

## Options considered

1. **Notify only.** Ask for the list of releases, and if a newer desktop version exists, offer to open its release page. Works the same on every platform without signing.
2. **`electron-updater` where it works** (Windows and AppImage), notify only on macOS and `.deb`. Two behaviours to explain and test, and update metadata to publish with every release.
3. **Full auto-update everywhere.** Option 2 plus a paid Apple Developer account, notarization and signing secrets in CI.

## Decision

We will use option 1.

- **What is requested.** The main process asks `https://api.github.com/repos/federicovezzoli/furrow-cam/releases?per_page=100`. It takes the highest `@furrow/desktop@x.y.z` tag that isn't a draft or prerelease, and compares it with the running version. The request carries no cookies and no identifier; GitHub sees the IP address and Electron's user agent. Nothing else leaves the app.
- **Where it runs.** The request goes through its own in-memory session. That session's request filter lets through only that URL; the window's session still cancels every request, and its CSP is unchanged.
- **Consent.** On first start, a dialog asks whether to check at start-up. The answer, and a version the user chose to skip, are kept in `updates.json` in the data folder, apart from the renderer's `settings.json`. *Help → Check for Updates at Start-up* changes the answer. *Help → Check for Updates…* always works and reports "up to date", the new version, or that it couldn't check.
- **The notice.** "Furrow CAM X.Y.Z is available", with *Download* (opens the release page in the system browser), *Skip This Version* and *Later*. A start-up check that fails says nothing.

## Consequences

- Users learn about new versions without visiting the releases page, on every platform, without code signing.
- The app is no longer entirely offline: PRD-0007 D2 now allows this one request, and only with the user's consent.
- Installing is still manual: download and run the installer over the old version.
- The check reads the 100 newest releases of all packages. If a hundred releases of other packages followed the last desktop release, it wouldn't find that one; a stable endpoint (#201) would remove that limit, and the check can move to it.
- Automatic installs remain possible later (options 2 and 3) without changing the notice.
