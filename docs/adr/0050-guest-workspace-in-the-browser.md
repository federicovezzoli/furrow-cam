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
- Projects can already be exported and imported as `.furrow` archives with their STL files (ADR-0047), and the web imports them through server actions. Those actions, like creating a project, require a machine: `prepareImport` refuses a document without one when the account has no machines. Freemium limits (ADR-0017) are proposed but not implemented, so no create path checks them yet.
- We collect no personal data beyond the email address (ADR-0013).
- The only default bit is `DEFAULT_TOOL`, seeded into each new library. Machine presets live in `@furrow/document` (`machine-presets.ts`).

## Options considered

**Where guest projects live**

1. **Anonymous server accounts** (Better Auth anonymous sessions): projects stored like any other, converted on sign-up. Stores data for every visitor, needs cleanup of abandoned rows, and turns the server into storage for people who never chose to sign up (ADR-0013).
2. **Browser storage (IndexedDB)**: nothing leaves the browser, works offline after load, survives reloads. Lost if the user clears site data, and tied to one browser.
3. **Memory only**: lost on reload.

**How guest work reaches an account**

1. **Automatic upload on first sign-in**: no friction, but imports projects the user may not want and can silently hit the project limit.
2. **Offer to import**, through the existing archive import: the user picks; validation stays on the server path that already exists.

**Bit catalog**

1. **Seed every catalog bit into each library**: simple, but fills libraries, counts against the tool limit and can't be improved for existing users.
2. **A read-only catalog offered next to the user's library**: versioned with the code like machine presets, never stored per user.

## Decision

- **A third host, the guest host**, in `apps/web/src/features/workspace/guest/`, implements `WorkspaceHost` over IndexedDB: a `projects` store (id, name, document, saved time), a `meshes` store keyed by SHA-256, and a settings store (tours seen, panel sizes, the guest's own bits, the last opened project). `project.autosaves` is true; `versions` is `null`; `library.tools` are the guest's own bits, saved with the shared library functions; `library.machines` is empty; mesh limits are `DEFAULT_STL_LIMITS`. Documents are validated with the `@furrow/document` schema and migrated on load, as on the server.
- **Shared library logic moves into `@furrow/workspace`** (`lib/local-library.ts`): the desktop app's pure list functions, used by the desktop host and the guest host.
- **Routes:** guest projects use the account's addresses: `/projects`, `/projects/<id>` and `/projects/<id>/simulate` read the session on the page and, without one, render the guest list or the guest project shell, loaded from the browser. `/` opens the guest's last project at its address and `/new` a new one (the website's link); `proxy.ts` sends signed-in users from both to `/projects`. `/tools` and `/machines` stay behind sign-in.
- **What needs an account is a host capability**, not a check in each component: `WorkspaceHost` gains an optional `account: { prompt(reason) }`, where `reason` is `"export-gcode" | "machine"`. Only the guest host has it, so the web and desktop hosts are unchanged; where it is present, those actions call `prompt` instead of running, and the guest host opens the account dialog (PRD-0008 G6). The dialog offers sign-up and sign-in (signed-in users at `/` are sent to `/projects`, where the import offer is), the desktop download link for the visitor's platform, and a `.furrow` export of the open project.
- **Importing guest projects** after sign-in: `/projects` checks IndexedDB on the client and, when it holds projects, offers to import them. Each chosen project is packed as a `.furrow` archive and sent through the existing import server action, so validation applies unchanged. Imported projects are removed from the browser; the rest stay until imported or discarded.
- **Projects don't need a machine**, for accounts as for guests: creating and importing a project accept `machine: null`, and `prepareImport` stops refusing a document without one. The machine is chosen in the stock pane, which already asks for one before G-code export and links to a new machine (where PRD-0004 M9's preset picker belongs). A guest project imported into a new account therefore needs no machine first.
- **Bit catalog** in `@furrow/document` (`tool-presets.ts`), beside the machine presets, with a test that every entry passes the `Tool` schema. `ToolChoice` gains an optional `catalog: true`; the workspace adds the catalog after `host.library.tools` in one place, so no host changes, the picker groups them, and catalog bits can't be edited in place (editing one saves a copy to the library, the guest's included). `DEFAULT_TOOL` becomes the catalog's default for operations when the library has no default.

## Consequences

- A visitor reaches the workspace with no request to our database; server persistence is unchanged. Accounts can create and import projects without a machine, so no step before the workspace asks for one.
- Guest work is as durable as the browser's site data. The project list says so, and the account dialog's file export lets users keep a copy.
- The server learns nothing about guests (ADR-0013); the privacy policy adds a sentence on browser storage.
- `WorkspaceHost` grows by one small capability; components that export G-code or pick a machine call `host.account.prompt` instead when the host has `account`.
- The desktop app gains the bit catalog for free.
- G-code export stays gated in an open source client, so a modified client can export as a guest. That is acceptable: the desktop app exports without an account anyway, and the gate exists to invite sign-up, not to protect anything.
- Imports of guest projects are not limited until ADR-0017 is implemented. When it is, its project count check must cover the import actions too, and the import offer must report projects refused for the limit.
- Guest projects never expire on our side (PRD-0008 open question, decided). The app doesn't call `navigator.storage.persist()` or warn about browser clearing: guest mode is for exploring, and both would add friction.
