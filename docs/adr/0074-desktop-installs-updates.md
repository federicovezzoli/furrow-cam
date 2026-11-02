# ADR-0074: The desktop app installs updates itself on Windows and Linux

- **Status:** Proposed
- **Date:** 2026-11-02
- **Deciders:** Federico Vezzoli
- **Related:** PRD-0007 (D2, D12), ADR-0012, ADR-0013, ADR-0044, ADR-0048, ADR-0049; #457. Supersedes ADR-0048 in part.

## Context

ADR-0048 only tells users about a new version: they open the release page, download the installer and run it by hand every time. It left automatic installs open (its option 2).

`electron-updater` downloads and installs an update itself where the app needn't be signed: Windows (NSIS), AppImage, `.deb` and pacman. On macOS it goes through Squirrel.Mac, which refuses an app without a Developer ID signature, and ours is ad-hoc (ADR-0044).

Three things stand in the way:

- **Finding the release.** There is one GitHub Release per package (ADR-0012), so `electron-updater`'s GitHub provider, which expects the newest release to be the app's, can't be used. The download Worker (ADR-0049) already finds the newest desktop release that has a given file.
- **Update metadata.** `electron-updater` reads `latest.yml` (Windows) or `latest-linux.yml`, which electron-builder writes only when `publish` is configured, along with the `app-update.yml` it embeds in the app.
- **The network.** The app cancels every request except the update check and telemetry, each in its own session (PRD-0007 D2). `electron-updater` makes its requests (metadata, the installer, GitHub's redirect to its file storage) through its own session, `electron-updater`, and sends an `x-user-staging-id` header with every check: a random ID it keeps in the data folder, for staged rollouts.

What `electron-updater` needs on Linux:

- **AppImage:** replaces the file itself, no password.
- **`.deb` and pacman:** runs `dpkg -i` or `pacman -U --noconfirm` through `pkexec` (or `gksudo`, `kdesudo`, `sudo`), so it asks for the administrator password, which needs a polkit agent; most desktop environments have one. If `dpkg` fails it runs `apt-get install -f`; if `pacman -U` fails it runs `pacman -Sy` and tries again, a partial sync Arch advises against, though only after the plain install failed. A refused password or a missing agent makes the install fail, and the app says so.

## Options considered

1. **Keep the notice everywhere** (ADR-0048). Nothing to build; every update stays manual.
2. **`electron-updater` on Windows and AppImage only**, the notice for `.deb`, pacman and macOS. No password prompts, but three behaviours on Linux.
3. **`electron-updater` on Windows, AppImage, `.deb` and pacman, the notice on macOS**, with the Worker as the update endpoint.
4. **Option 3 plus macOS**, with a paid Apple Developer account, notarization and signing secrets in CI.

## Decision

We will use option 3. The package installs ask for a password, but they work on the desktops our users run, and a failure falls back to the release page.

- **Endpoint.** electron-builder's `publish` is the `generic` provider at `https://download.furrow.cam/update`. Release builds attach `latest.yml`, `latest-linux.yml` and the `.blockmap` files to the `@furrow/desktop@x.y.z` release, next to the installers. The Worker redirects `/update/latest.yml` and `/update/latest-linux.yml` to the newest desktop release that has them. The metadata names its installer relative to itself, so `/update/furrow-cam-<version>-<file>` redirects straight to that version's release file; that also covers the previous version's blockmap for a differential download, which falls back to a full download where it's missing. These requests are not counted as downloads.
- **Requests.** `electron-updater`'s session cancels every request except to `https://download.furrow.cam/update/`, the desktop release files on `github.com`, and GitHub's file storage (`release-assets.githubusercontent.com`, `objects.githubusercontent.com`) they redirect to. The app takes that session from `electron-updater` itself, so it filters the one the requests use. The `x-user-staging-id` header is removed from every request: its file is still written, but never leaves the computer. Cloudflare and GitHub see the IP address and user agent, as with ADR-0048's check. The window's session and its CSP are unchanged.
- **Consent.** Unchanged: the start-up question, *Check for Updates at Start-up*, *Skip This Version* and `updates.json` mean what they did. `autoDownload` is off: on Windows and Linux the check asks for `latest*.yml` only, and nothing downloads until the user clicks *Download and Install*.
- **Installing.** The notice's *Download* becomes *Download and Install*. The window's taskbar entry shows the progress, and *Check for Updates…* says the download is under way; then *Restart Now* or *Later*. *Restart Now* quits as *Quit* does, asking about unsaved projects, and only then installs (silently on Windows) and starts the new version, releasing the single-instance lock first so the new version isn't turned away; *Cancel* in that prompt cancels the restart too. After *Later*, the update installs when the app quits (`autoInstallOnAppQuit`). If the download or install fails, the app says so and offers the release page.
- **Where.** Windows, an AppImage, and `.deb` and pacman packages (electron-builder writes `resources/package-type`, which tells `electron-updater` which one). macOS keeps ADR-0048's notice and its request to GitHub's releases API, as does anything `electron-updater` doesn't treat as installed (an unpacked AppImage, a development build).
- **Windows signing.** Without `publisherName`, `electron-updater` doesn't check the installer's signature, so unsigned updates install. The installer is the release's, over HTTPS, and checked against the SHA-512 in `latest.yml`.

## Consequences

- On Windows and Linux an update is two clicks and a restart; on `.deb` and pacman, also the password.
- The app trusts the Worker and the GitHub release for its code, as users already did when downloading by hand. Anyone able to replace the Worker or upload to a desktop release can ship an update.
- If GitHub moves its file storage to another host, downloads fail until a new version allows it; that version has to be installed by hand.
- Releases depend on the Worker: until a release's `latest*.yml` is attached, the Worker serves the previous one, and apps see no update.
- macOS installs remain manual until the app is signed and notarized (option 4, a follow-up).
