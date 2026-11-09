# ADR-0081: The update notice opens the website's download section

- **Status:** Proposed
- **Date:** 2026-11-09
- **Deciders:** Federico Vezzoli
- **Related:** ADR-0048, ADR-0049, ADR-0074; #539

## Context

The desktop app's update notice (ADR-0048) opens the new version's GitHub release page on macOS, and so does the fallback after a failed install on Windows and Linux (ADR-0074). That page lists every file of the release (each installer, `latest*.yml`, blockmaps), so users have to find theirs, and downloads from it bypass the download Worker, which counts only its own links (ADR-0049).

The website's download section, `https://furrow.cam/#download`, names each installer and links it through `download.furrow.cam/<platform>`.

## Options considered

1. **Keep the release page.** It has the release notes, but it's the hardest place to pick an installer, and downloads aren't counted.
2. **The website's download section.** One page for every system, each link counted.
3. **The installer itself** (`download.furrow.cam/mac-arm64` or `mac-x64`, chosen by the app's architecture). One click, but the browser starts a download with no page around it, and the failure fallback on Windows and Linux would still need a choice of package.

## Decision

We will use option 2. *Download* in the update notice, and after a failed install, opens `https://furrow.cam/#download` in the system browser. The update check's requests don't change. The start screen's version number still links to that version's release notes on GitHub.

## Consequences

- Users pick their installer from a short list, and the Worker counts those downloads.
- The notice no longer depends on the URL in GitHub's answer, so the check reads only the tag, draft and prerelease fields.
- The website's `#download` anchor becomes part of the app's contract: renaming it breaks the notice in every installed version.
