# Product Requirements Documents

A PRD describes **what** we build and **why**: the problem, the users, the scope, and how we'll know it works. It deliberately avoids **how**; implementation choices belong in [ADRs](../adr/).

## Process

1. Copy [`0000-template.md`](0000-template.md) to `NNNN-short-title.md` using the next free number.
2. Start as **Draft**, iterate via PRs and issues.
3. Move to **Approved** when scope is agreed. Unlike ADRs, PRDs may be revised after approval; note changes in the changelog section.
4. Mark **Shipped** when delivered, or **Abandoned** with a reason.

Statuses: `Draft` · `Approved` · `Shipped` · `Abandoned`

## Index

| # | Title | Status |
| --- | --- | --- |
| [0001](0001-mvp.md) | MVP: 2D vector → G-code for hobby CNC routers | Draft |
| [0002](0002-zero-point.md) | Zero point selection | Draft |
| [0003](0003-freemium-limits.md) | Freemium usage limits | Draft |
| [0004](0004-machine-presets.md) | Machine presets | Draft |
| [0005](0005-stl-relief-machining.md) | STL relief machining | Draft |
| [0006](0006-gcode-simulation.md) | G-code simulation | Abandoned |
| [0007](0007-desktop-app.md) | Desktop app | Draft |
| [0008](0008-try-without-account.md) | Use the app without an account | Shipped |
| [0009](0009-several-drawings.md) | Several drawings, arranged on the stock | Draft |
