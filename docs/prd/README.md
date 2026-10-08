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
