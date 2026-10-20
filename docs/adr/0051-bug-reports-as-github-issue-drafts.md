# ADR-0051: Bug reports are prefilled GitHub issue drafts the user submits

- **Status:** Proposed
- **Date:** 2026-10-20
- **Deciders:** Federico Vezzoli
- **Related:** ADR-0013, ADR-0044, ADR-0045; #280

## Context

Users who hit a bad toolpath or a crash had no way to report it from the app, and reports arrived without the version, platform or settings needed to reproduce them. A report needs a place to go and some diagnostics, and both touch privacy: ADR-0013 keeps the personal data we hold to the email address, and the desktop app's renderer has no network (ADR-0044).

## Options considered

1. **A prefilled GitHub issue draft.** The app builds an `issues/new` link with a title, a body and diagnostics, and opens it in the browser. The user reviews it and submits it from their own GitHub account.
2. **Our own endpoint**, storing reports (and screenshots) on our server, maybe forwarding them to GitHub. No GitHub account needed, but we would hold reports, IP addresses and images, and the desktop app would need a network exception.
3. **A third-party feedback service.** Same data concerns, plus another processor.

## Decision

We will use option 1.

- **Where.** The workspace's top bar opens a dialog; the footers and the desktop app's *Help → Report a Bug…* open a draft with the app's version (and the system, on desktop).
- **What the dialog fills in**, shown before anything leaves the app: the app and version, the user agent, the GPU's name, the document's schema version and units, the machine's name and post-processor, and the selected operation's settings. It leaves out the project's name, the geometry, the operation's targets, and every `name` and `notes` in the operation and its tools.
- **Long reports.** GitHub refuses very long links, so past 6 000 characters the body is copied to the clipboard and the draft asks the user to paste it.
- **Screenshot.** A link can't carry a file and GitHub has no public upload API, so the dialog captures the viewport for the user to copy or save and drop into the issue. Nothing is uploaded. The canvas renders a frame and is read in the same task, so it doesn't keep its drawing buffer.

## Consequences

- We store nothing: a report exists only if the user submits it on GitHub, where it is public. The privacy page says so.
- Reporting needs a GitHub account.
- Attaching the screenshot or the project file stays a manual step.
