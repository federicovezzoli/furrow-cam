# PRD-0008: Use the app without an account

- **Status:** Shipped
- **Author:** Federico Vezzoli
- **Created:** 2026-10-18
- **Related:** PRD-0001 (R13, R17, R18, R19, R22), PRD-0003, PRD-0004, PRD-0007, ADR-0013, ADR-0045, ADR-0050

## Problem

Before a visitor sees the workspace, the web app asks them to create an account, confirm their email, sign in, and then set up a machine with about ten technical values. Most visitors leave somewhere in that funnel without seeing what Furrow CAM can do. Nothing they need to *try* the app (importing a drawing, adding operations, previewing toolpaths, simulating) needs an account or a machine: only exporting G-code needs a machine, and only a personal bit library needs storage that follows the user.

## Users

- Visitors arriving from the website, a forum post or a video who want to see whether Furrow CAM fits their job before committing to anything.
- Hobby router owners who don't know their machine's values yet and want to explore first.

## Goals

- A visitor goes from the website to toolpaths on their own drawing in under a minute, with no form to fill in.
- We ask for an account, or point to the desktop app, only when the visitor wants something that needs one: G-code for a machine, or their own bits.
- Nothing a visitor makes is lost when they create an account.

## Non-goals

- **Syncing** guest work across browsers or devices; it stays in the browser it was made in.
- **G-code export without an account** on the web. Visitors who don't want an account use the desktop app (PRD-0007).
- **Machine choice for guests.** Machines, including presets (PRD-0004), belong to an account or the desktop app.
- **Bit presets traced to maker charts** (the PRD-0004 non-goal stands). The catalog's values are generic starting points.
- Changes to sign-up and sign-in (PRD-0001 R17) or to freemium limits for accounts (PRD-0003).

## Requirements

| ID | Requirement | Priority |
| --- | --- | --- |
| G1 | `app.furrow.cam` opens the workspace without signing in: the visitor's last project, or a new one on the first visit. `/new` always opens a new one. Guest projects use the addresses an account's projects have (`/projects`, `/projects/<id>`, `/projects/<id>/simulate`). Signed-in users still land on their projects | Must |
| G2 | Guest projects, their STL files and settings (tours seen, panel sizes) are kept in the browser, survive reloads, and are never sent to the server | Must |
| G3 | A guest can keep several projects: create, open, rename, delete, import a `.furrow` file and export one, from a project list reached from the workspace | Must |
| G4 | A **bit catalog** in the repository offers common bits to everyone (guests, accounts, the desktop app): flat end mills in metric and imperial sizes (upcut, downcut, compression), ball nose, and 30°, 60° and 90° V-bits | Must |
| G5 | Catalog values are conservative starting points for softwood and plywood on a hobby router, and the picker says so. Catalog bits are read-only and won't count towards the tool limit once limits exist (PRD-0003) | Must |
| G6 | A guest who exports G-code or chooses a machine sees a dialog explaining what needs an account, with: **Create a free account**, **Sign in**, **Download the desktop app** (for their system) and **Save this project as a file** | Must |
| G7 | After signing in, a browser that holds guest projects offers to import them: the user picks which ones, or dismisses the offer (asked again next time) or discards them. Imported projects need no machine (G13); the offer lists any project that failed to import, with the reason. Once project limits exist (PRD-0003), imports count towards them | Must |
| G8 | Signing up from the dialog (G6) brings the user back to the project they were in once they sign in, with the import offer (G7) | Should |
| G9 | The workspace top bar shows **Sign in** for guests, where accounts see their account menu | Must |
| G10 | The privacy policy says that guest projects stay in the browser's storage and how to remove them | Must |
| G11 | The website's main call to action opens a new guest project in the workspace (`app.furrow.cam/new`) instead of the sign-up page | Must |
| G12 | The guided tour (PRD-0001 R22) runs for guests, remembered per browser | Should |
| G13 | Accounts can create and import projects without a machine; the machine is chosen in the project before exporting G-code | Must |
| G14 | A guest can add and edit their own bits, kept in the browser beside the catalog's | Must |

## User flow

1. A visitor clicks **Open the app** on furrow.cam and lands in an empty workspace, with the tour.
2. They import an SVG, add a profile and a pocket with bits from the catalog, and watch the simulation.
3. They click **Export G-code**. A dialog explains that G-code is made for a machine, and machines are saved in a free account or the desktop app.
4. They click **Create a free account**, confirm their email and sign in.
5. The app offers to import their guest project; they accept and are back in it, now saved to their account.
6. They add a machine from a preset and export G-code.

## Success criteria

- The share of website visitors who reach the workspace and import a drawing rises clearly compared with today's sign-up rate.
- A guest project imported after sign-up has the same document and STL files it had in the browser.
- No guest data reaches the server before the user imports it.

## Open questions

- ~~Should guest projects expire from browser storage after a long period without visits, or stay until the user removes them?~~ They never expire on our side: they stay until the guest deletes, discards or imports them. The browser may still clear them (low disk space, Safari's seven-day limit on script-written storage for sites not visited, cleared site data, private windows). That is accepted: guest mode is for exploring the app, so we don't ask for persistent storage or warn about it, which would add friction. The project list's note and the account dialog's file export cover users who want to keep their work.

## Changelog

- 2026-10-18: initial draft
- 2026-10-19: G13, projects without a machine, so imported guest projects need none; G5 and G7 no longer assume freemium limits are enforced (#226 review)
- 2026-10-19: open question decided: guest projects never expire, and the browser clearing them is accepted rather than guarded against
- 2026-10-19: shipped (#220–#225, #227; milestone "Guest mode")
- 2026-10-19: G1 guest projects at the account's addresses and `/new`; G6 bits no longer need an account, G14 guests keep their own bits; G11 the website links to `/new`
