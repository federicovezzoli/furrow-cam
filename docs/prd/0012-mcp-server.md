# PRD-0012: MCP server

- **Status:** Draft
- **Author:** Federico Vezzoli
- **Created:** 2026-10-24
- **Related:** PRD-0001, PRD-0005, PRD-0007, ADR-0003, ADR-0004, ADR-0013, ADR-0028, ADR-0045, ADR-0047, ADR-0052

## Problem

Users increasingly work with AI assistants (Claude, ChatGPT, editors with agents) that can call tools through the Model Context Protocol (MCP). Today an assistant can't open a Furrow CAM project: it can only describe steps for the user to click through. A request such as "make the G-code for this SVG on an 18 mm panel with a 6 mm end mill, outside cut with four tabs" or "add a finishing pass to the project I'm working on" still needs the user to do every step in the app.

## Users

- Hobbyists who describe a job to an assistant and want a project and G-code they can check in the app.
- Users who repeat similar jobs and want an assistant to set them up from a sentence.
- Developers who script Furrow CAM from an agent.

## Goals

- An assistant can do everything the workspace does to a project (import, stock and zero, tools, operations, checks, G-code export) through MCP tools, with the same results as the app.
- Phase 1 works locally on `.furrow` files, with no account: Furrow CAM uploads nothing. What the server returns goes to the user's assistant, which decides where it is sent (a cloud model, for most assistants).
- Phase 2 reaches the projects saved in the user's web account.
- The user can always see and undo what an assistant changed.

## Non-goals

- Sending G-code to the machine or controlling it. The user always loads and runs the G-code themselves.
- A chat or an assistant built into the app.
- Tools that drive the app's UI (clicking, viewport); the server works on project documents.
- Sharing a local server over the network.

## Requirements

| ID | Requirement | Priority |
| --- | --- | --- |
| M1 | **Local server (phase 1):** an MCP server that runs on the user's computer (stdio), opens and creates `.furrow`, `.furrow.zip` and `.furrow.json` projects by path, and saves them as `.furrow` like the desktop app (ADR-0047) | Must |
| M2 | Read a project: a summary of stock, zero, machine, drawings, models and operations, with their settings, in millimetres and in the project's units | Must |
| M3 | Import SVG, DXF and STL files by path into a project, with the same limits, units and placement rules as the app | Must |
| M4 | Set the stock, the zero and the machine; read the desktop app's tool library and machine list (ADR-0047) and add tools to a project | Must |
| M5 | Add, edit, reorder, enable, disable and remove operations of every type, with the same defaults and validation as the app. An invalid request is refused with the app's message | Must |
| M6 | Check a project: the problems the app shows (tools, toolpath warnings) and whether there is anything to cut | Must |
| M7 | Export G-code to a path, for the project's post-processor, identical to the app's export | Must |
| M8 | Before the first change in a session, the server keeps the project as an automatic version (ADR-0028), so the user can restore what the assistant changed | Must |
| M9 | Installed with one command, with setup instructions for common MCP clients (Claude Desktop, Claude Code, editors) | Must |
| M10 | A top view of the toolpaths as an image, so an assistant can show or check them | Could |
| M11 | **Remote server (phase 2):** an MCP endpoint on the web app that reaches the signed-in user's cloud projects, with the user granting access through their account (OAuth) and able to revoke it | Should |
| M12 | The desktop app offers to set up the local server for the user's MCP clients | Could |

## User flow

1. The user installs the local server in Claude Desktop with the command from the docs.
2. They ask: "Make a project from `~/signs/rossi.svg`, 300 × 200 × 18 mm pine, zero at the bottom-left of the top face. V-carve the lettering with my 60° bit and cut the outline out with the 6 mm end mill, with four tabs."
3. The assistant creates `rossi.furrow`, imports the drawing, sets the stock and zero, adds the two operations with tools from the library, checks the project and reports any problems.
4. The user opens `rossi.furrow` in the desktop app, looks at the toolpaths and the simulation, and asks the assistant to export the G-code (or exports it themselves).

## Success criteria

- An assistant goes from an SVG and a one-sentence brief to a project and G-code that the user cuts on a GRBL machine without manual G-code edits.
- G-code exported through the server is byte-identical to the app's export of the same project.
- In phase 1, Furrow CAM sends no project content or personal data anywhere; the docs say that tool results go wherever the user's assistant sends them.

## Open questions

- Phase 2: the server never computes toolpaths or G-code (ADR-0004). Does the remote server only edit documents and leave export to the app, or does a new ADR allow server-side export for MCP?
- Phase 2: which OAuth provider for Better Auth, and does granting access to an MCP client collect any new personal data (ADR-0013)?
- Does the local server send anonymous usage events like the apps (ADR-0052), or none at all?

## Changelog

- 2026-10-24: initial draft
- 2026-10-24: phase 1 uploads nothing, but tool results go where the assistant sends them
