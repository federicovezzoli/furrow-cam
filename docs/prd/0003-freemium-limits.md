# PRD-0003: Freemium usage limits

- **Status:** Draft
- **Author:** Federico Vezzoli
- **Created:** 2026-10-11
- **Related:** PRD-0001, ADR-0004, ADR-0013, ADR-0017

## Problem

The public instance of Furrow CAM has running costs (database, email, hosting) that grow with usage. To offer it for free and sustainably, and to leave room for a paid plan later, the hosted instance needs a free tier with usage limits.

Self-hosters, who run the MIT-licensed code on their own infrastructure, must not be affected: limits are off unless explicitly enabled.

## Users

- **Free users** of the public instance: hobbyists who cut a few projects at a time.
- **The operator** of an instance (today, the maintainer of the public instance; also self-hosters), who decides whether limits apply and how high they are.

## Goals

- One switch turns usage limits on for an instance; off by default.
- Limits on projects, tools, machines and daily G-code exports, each configurable.
- Users always see how much of each limit they've used, and get a clear message instead of a failure when they reach one.
- Nobody loses access to existing work when limits are turned on or lowered.

## Non-goals

- **Paid plans, payments and billing.** Per-user plans or exemptions come in a later PRD; for now the limits apply to every user equally.
- **Hard enforcement of the export limit** against modified clients (see F6).
- Limits on project size, geometry or toolpath complexity.
- Request rate limiting (already handled for authentication by Better Auth).

## Requirements

| ID | Requirement | Priority |
| --- | --- | --- |
| F1 | An instance-wide feature flag (`FREEMIUM_ENABLED`) turns limits on; it is **off by default**, so instances without it have no limits | Must |
| F2 | The limits are set by the operator: maximum projects, maximum tools (all bits in the library, including the one seeded at sign-up), maximum machines, and maximum G-code exports per user per day (UTC). Each is a positive integer and **must be set** when the flag is on; the app refuses to start otherwise | Must |
| F3 | The server refuses to create a project (new or imported), a tool or a machine when the user is at or above the limit, with a clear error | Must |
| F4 | Items above a limit are never removed or locked: users keep full access to everything they have, and can only create new items once they are back under the limit | Must |
| F5 | Seeding the default bit at sign-up never fails because of limits | Must |
| F6 | **Soft export quota:** before generating a G-code file, the app asks the server to count the export; the server refuses once the user has reached today's limit. Because G-code is generated in the browser (ADR-0004) and the code is open source, a modified client can bypass this; that is accepted | Must |
| F7 | Export counting stores the minimum: one counter per user for the current day, overwritten each day; no export history (ADR-0013) | Must |
| F8 | When the flag is on, the UI shows usage next to each limit (e.g. "2 / 3 projects", "4 exports left today"); create buttons at a limit are disabled with an explanation; a refused export explains the daily limit and when it resets | Must |
| F9 | When the flag is off, no usage is shown, no exports are counted and nothing extra is stored | Must |

## User flow

1. A free user creates projects until the projects page shows "3 / 3 projects"; **New project** is disabled with "You've reached the free plan's limit of 3 projects. Delete a project to create a new one."
2. They export G-code a few times; the export button shows how many exports are left today. At the limit, export explains that the quota resets at midnight UTC.
3. The operator raises a limit by changing an environment variable and redeploying; users immediately see the new numbers.

## Success criteria

- With the flag off, behaviour is identical to today (no extra queries on create, no export call).
- With the flag on, none of the server-enforced limits (F3) can be exceeded through the UI or by calling the server actions directly.

## Open questions

- None at the moment.

## Changelog

- 2026-10-11: initial draft
