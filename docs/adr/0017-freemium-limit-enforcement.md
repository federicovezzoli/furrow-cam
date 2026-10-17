# ADR-0017: Enforcing freemium usage limits

- **Status:** Accepted
- **Date:** 2026-10-11
- **Deciders:** Federico Vezzoli
- **Related:** PRD-0003, ADR-0003, ADR-0004, ADR-0013

## Context

PRD-0003 adds optional usage limits on projects, tools, machines and daily G-code exports, switched on by an instance-wide flag. We need to decide where limits live, where they are enforced, and how exports are counted, given that:

- Projects, tools and machines are created only through server actions (ADR-0003).
- G-code is generated and downloaded entirely in the browser (ADR-0004); the server never sees it.
- The code is open source, so any client-side check can be removed.
- We store as little user data as possible (ADR-0013).

## Options considered

**Configuration**

1. **Environment variables**: simple, validated at startup by `env.ts`, change needs a redeploy.
2. **Database settings table**: changeable at runtime, but needs an admin UI and adds a query to every check.

**Export counting**

1. **Generate G-code on the server** so it can enforce the quota: contradicts ADR-0004 and adds server cost.
2. **Soft quota**: the client asks the server to record an export before generating it; the server refuses over the limit. Bypassable by a modified client.
3. **No export limit.**

**Export counter storage**

1. **Event log** (one row per export): enables analytics, but is usage history we don't need (ADR-0013).
2. **One counter row per user**, holding the current day and its count, overwritten when the day changes.

## Decision

- **Configuration in environment variables:** `FREEMIUM_ENABLED` plus `FREEMIUM_MAX_PROJECTS`, `FREEMIUM_MAX_TOOLS`, `FREEMIUM_MAX_MACHINES`, `FREEMIUM_MAX_DAILY_EXPORTS`. `env.ts` requires all four limits (positive integers) when the flag is on. A single server module (`lib/limits.ts`) is the only reader of these variables.
- **Server-side enforcement in the create paths:** every server action that creates a project (new or imported), a tool or a machine checks the user's count against the limit in the same transaction as the insert. Updates, deletes and reads are never limited (PRD-0003 F4). Seeding the default bit at sign-up bypasses the check (F5; limits are at least 1).
- **Soft export quota:** before starting the G-code worker, the client calls a `recordGcodeExport` server action. It increments the user's counter atomically (a single `INSERT … ON CONFLICT … DO UPDATE` that resets the count when the stored day isn't today, UTC, and only increments while under the limit) and returns the remaining quota or a refusal. G-code generation stays in the browser (ADR-0004 unchanged).
- **Counter storage:** an `ExportQuota` table with one row per user (`userId` primary key, `day`, `count`), deleted with the user. No history is kept.
- **Flag off:** the checks short-circuit before any query, the client skips the export call, and no counter rows are written.

## Consequences

- The project, tool and machine limits can't be exceeded through the UI or by calling server actions directly.
- The export limit only binds unmodified clients; this is documented in PRD-0003 and acceptable for a free tier of an open source app.
- Two concurrent creates can race past a count check unless the check and insert share a transaction with a per-user lock; the implementation must handle this (e.g. `SELECT … FOR UPDATE` on the user row).
- Changing limits requires a redeploy; a settings UI can replace environment variables later without changing the enforcement points.
- New environment variables must be added to `turbo.json`, `.env.example` and the CI placeholders (AGENTS.md).
