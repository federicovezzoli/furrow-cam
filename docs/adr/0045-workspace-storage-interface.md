# ADR-0045: The workspace saves and loads through a storage interface

- **Status:** Proposed
- **Date:** 2026-10-18
- **Deciders:** Federico Vezzoli
- **Related:** PRD-0007, ADR-0003, ADR-0010, ADR-0021, ADR-0028, ADR-0029, ADR-0036, ADR-0044, ADR-0046; #184

## Context

The workspace calls the web app's server actions and Next.js APIs directly:

- autosave calls `saveProject` (`features/workspace/providers/workspace-stores.tsx`);
- meshes are uploaded and downloaded through presigned S3 URLs (`features/assets/lib/meshes.ts`, ADR-0029);
- the versions pane calls the version actions (ADR-0028);
- the tool library dialogs refresh with `useRouter` after saving to the server's tool library;
- the guided tour calls `finishTour` (ADR-0036);
- the workspace layout loads the project, the tool library and the machine list on the server behind a session;
- links (`next/link`), the simulator route and `next/dynamic` tie it to the Next.js router.

The desktop app (ADR-0044) needs the same workspace with files on disk behind it.

## Options considered

1. **Branch on the platform inside the workspace.** Every call site checks whether it runs in Electron. Simple at first, but the web app's bundle would carry desktop code, and every new call site must remember both.
2. **A storage interface provided through a React context.** The workspace depends only on the interface; each app supplies its implementation.
3. **Run the Next.js server inside Electron** with a local SQLite database. Keeps the code as is, but ships a server and a database in the app, and still needs a different persistence model for files.

## Decision

We will use option 2.

- **`WorkspaceHost`.** The workspace receives one object through a React context, with these parts:
  - **`project`**: the open project's document, its last-saved time and `save(document, savedAt)`. The web app calls `saveProject`; the desktop app writes the crash-recovery copy and marks the window modified (ADR-0047).
  - **`meshes`**: `put(sha256, bytes)` and `get(sha256)`. The web app uses the presigned URLs of ADR-0029; the desktop app keeps meshes in memory and in the file.
  - **`versions`**: list, create, rename, delete and restore (ADR-0028), or `null` where versions are unavailable.
  - **`library`**: the tool library and machine list, and saving a tool from the workspace's bit dialogs.
  - **`settings`**: tour state and similar per-user flags.
  - **`navigation`**: links out of the workspace (projects list, tools, machines) and switching between the workspace and the simulator. The web app maps these to routes; the desktop app to its own view state.
  - **`limits`**: mesh limits (PRD-0005 S1), as `meshLimits` today.
- **Web implementation** in `apps/web/src/features/workspace/host/`: wraps the existing server actions. Nothing changes for web users, and it ships before any desktop work.
- **Desktop implementation** in `apps/desktop`: calls the preload API (ADR-0044) for file access.
- **Lazy loading.** Browser-only components (the viewports) are loaded with `React.lazy` instead of `next/dynamic`, so the workspace doesn't import Next.js.
- **Errors.** Every method returns the same `ActionResult` shape the server actions return today, so the workspace's error handling stays as it is.

## Consequences

- The workspace no longer imports `@/features/projects/actions`, `@/features/assets/actions`, `@/features/onboarding/actions`, `next/link`, `next/navigation` or `next/dynamic`, which is what lets it move into a package (ADR-0046).
- Tests can drive the workspace with an in-memory host.
- New persistence needs (a new kind of asset, a new setting) are added to the interface and implemented twice.
