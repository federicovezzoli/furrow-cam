# PRD-0007: Desktop app

- **Status:** Draft
- **Author:** Federico Vezzoli
- **Created:** 2026-10-18
- **Related:** PRD-0001, PRD-0005, ADR-0044, ADR-0045, ADR-0046, ADR-0047, ADR-0048

## Problem

Furrow CAM only runs as a hosted web app: users need an account and a connection, and their projects live on our server. Many hobby router owners work in a garage or workshop with a poor connection, don't want an account for a tool they use offline, or want their projects as files they can back up, copy to the machine's computer and keep in their own folders.

## Users

- Hobby router owners who prefer a classic desktop application: download it, open it, save projects as files.
- People evaluating Furrow CAM who don't want to sign up first.

## Goals

- A user installs Furrow CAM, creates a project, generates G-code and saves the project to a file, with no account and no network connection.
- A project made in the desktop app opens in the web app, and the other way round.

## Non-goals

- **Syncing** between the desktop app and a web account.
- **Code signing and automatic installs.** The app tells users about a new version (D12), but they download and install it themselves.
- **Usage limits** (PRD-0003) and analytics.
- **Mobile or tablet apps.**

## Requirements

| ID | Requirement | Priority |
| --- | --- | --- |
| D1 | Installers for macOS (Apple Silicon and Intel), Windows and Linux are published with every release on the GitHub releases page | Must |
| D2 | The app works fully offline and makes no network requests other than the update check the user agreed to (D12); there is no account and no sign-in | Must |
| D3 | The workspace is the web app's: import, operations, toolpaths, simulation, G-code export, 3D models (PRD-0005) | Must |
| D4 | A start screen offers New project, Open and the recently opened files | Must |
| D5 | Projects are saved as `.furrow` files with New, Open, Save, Save As and Close; the window shows unsaved changes and the app asks before closing or quitting with them | Must |
| D6 | The app opens `.furrow`, `.furrow.zip` and `.furrow.json` files, and double-clicking a `.furrow` file opens it | Must |
| D7 | If the app crashes or is killed, the next start offers to restore the unsaved changes | Must |
| D8 | Named versions (PRD-0001 R13c) are saved inside the project file | Must |
| D9 | A tool library and machine list are kept on the computer and used for new projects, as in the web app | Must |
| D10 | The web app imports `.furrow` files | Must |
| D11 | The download page explains how to open the app the first time despite the operating system's warning for unsigned apps | Should |
| D12 | If the user agrees on first start, the app checks for a newer version at start-up and offers to open its release page; the user can check by hand from the Help menu and turn the start-up check off | Should |

## User flow

1. A user downloads the installer for their system from the releases page and installs it, following the note on the first-launch warning.
2. They open Furrow CAM, see the start screen and click New project, choosing a machine.
3. They import an SVG, add operations, check the simulation and export G-code.
4. They save the project as `Coasters.furrow` in their documents folder, and save a version named "first cut".
5. Days later they double-click `Coasters.furrow`, change the depth and save.

## Success criteria

- A user completes the flow above on each platform with the network disabled.
- A `.furrow` file saved by the desktop app imports into the web app with the same document, and a web export opens in the desktop app.

## Open questions

- None at the moment.

## Changelog

- 2026-10-18: created (#184, ADR-0044, ADR-0045, ADR-0046, ADR-0047)
- 2026-10-18: D12, an opt-in update check; D2 allows it (#212, ADR-0048)
