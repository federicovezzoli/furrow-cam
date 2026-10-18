# ADR-0050: Guests use the workspace with projects kept in the browser

- **Status:** Proposed
- **Date:** 2026-10-18
- **Deciders:** Federico Vezzoli
- **Related:** PRD-0008, PRD-0003, PRD-0004, ADR-0003, ADR-0004, ADR-0013, ADR-0017, ADR-0045, ADR-0047

## Context

PRD-0008 opens the web workspace to visitors without an account. Today `proxy.ts` redirects every request for `/projects`, `/tools` and `/machines` without a session cookie to `/sign-in`, and `/` is a page with two buttons: create an account or sign in. Facts that shape the decision:

- The workspace already runs on any storage through `WorkspaceHost` (ADR-0045): the web app's server and the desktop app's files are two hosts.
- CAM runs entirely in the browser (ADR-0004), so a guest costs the server nothing but static assets.
- The desktop app already keeps a tool library, machines and settings without an account, in pure functions (`apps/desktop/src/renderer/src/library.ts`) that read and update plain lists.
- Projects can already be exported and imported as `.furrow` archives with their STL files (ADR-0047), and the web import runs through server actions that check freemium limits (ADR-0017).
- We collect no personal data beyond the email address (ADR-0013).
- The only default bit is `DEFAULT_TOOL`, seeded into each new library. Machine presets live in `@furrow/document` (`machine-presets.ts`).

## Options considered

**Where guest projects live**

1. **Anonymous server accounts** (Better Auth anonymous sessions): projects stored like any other, converted on sign-up. Stores data for every visitor, needs cleanup of abandoned rows, and turns the server into storage for people who never chose to sign up (ADR-0013).
2. **Browser storage (IndexedDB)**: nothing leaves the browser, works offline after load, survives reloads. Lost if the user clears site data, and tied to one browser.
3. **Memory only**: lost on reload.

**How guest work reaches an account**

1. **Automatic upload on first sign-in**: no friction, but imports projects the user may not want and can silently hit the project limit.
2. **Offer to import**, through the existing archive import: the user picks; limits and validation stay on the server path that already exists.

**Bit catalog**

1. **Seed every catalog bit into each library**: simple, but fills libraries, counts against the tool limit and can't be improved for existing users.
2. **A read-only catalog offered next to the user's library**: versioned with the code like machine presets, never stored per user.

## Decision

- **A third host, the guest host**, in `apps/web/src/features/workspace/guest/`, implements `WorkspaceHost` over IndexedDB: a `projects` store (id, name, document, saved time), a `meshes` store keyed by SHA-256, and a settings record (tours seen, panel sizes). `project.autosaves` is true; `versions` is `null`; `library.machines` is empty; mesh limits are `DEFAULT_STL_LIMITS`. Documents are validated with the `@furrow/document` schema and migrated on load, as on the server.
- **Shared library logic moves into `@furrow/workspace`** (`lib/local-library.ts`): the desktop app's pure list functions, used by the desktop host and the guest host.
- **Routes:** `/` renders the guest workspace for visitors and redirects signed-in users to `/projects` (an optimistic cookie check in `proxy.ts`, validated on the page). The guest project list is a client view at `/` too. `/projects`, `/tools` and `/machines` stay behind sign-in.
- **What needs an account is a host capability**, not a check in each component: `WorkspaceHost` gains `account: { requireFor(reason): boolean }`, where `reason` is `"export-gcode" | "machine" | "save-bit"`. The web and desktop hosts always return `true`; the guest host opens the account dialog (PRD-0008 G6) and returns `false`. The dialog offers sign-up and sign-in with a `callbackURL` back to `/`, the desktop download link for the visitor's platform, and a `.furrow` export of the open project.
- **Importing guest projects** after sign-in: `/projects` checks IndexedDB on the client and, when it holds projects, offers to import them. Each chosen project is packed as a `.furrow` archive and sent through the existing import server action, so validation and the project limit (ADR-0017) apply unchanged. Imported projects are removed from the browser; the rest stay until imported or discarded.
- **Bit catalog** in `@furrow/document` (`tool-presets.ts`), beside the machine presets, with a test that every entry passes the `Tool` schema. `ToolChoice` gains `source: "catalog" | "library"`; every host adds the catalog to `library.tools`, the picker groups them, and catalog bits can't be edited in place (editing one saves a copy to the library, which for guests is gated). `DEFAULT_TOOL` becomes the catalog's default for operations when the library has no default.

## Consequences

- A visitor reaches the workspace with no request to our database; signed-in behaviour, server persistence and limits are unchanged.
- Guest work is as durable as the browser's site data. The project list says so, and the account dialog's file export lets users keep a copy.
- The server learns nothing about guests (ADR-0013); the privacy policy adds a sentence on browser storage.
- `WorkspaceHost` grows by one small capability; components that export G-code, pick a machine or save a bit call `host.account.requireFor` first.
- The desktop app gains the bit catalog for free.
- G-code export stays gated in an open source client, so a modified client can export as a guest. That is acceptable: the desktop app exports without an account anyway, and the gate exists to invite sign-up, not to protect anything.
- Follow-up: expiring old guest projects, if PRD-0008's open question decides so.
