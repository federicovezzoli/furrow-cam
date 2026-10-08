# ADR-0013: Data minimisation for user accounts

- **Status:** Accepted
- **Date:** 2026-10-08
- **Deciders:** Federico Vezzoli
- **Related:** ADR-0003, ADR-0006

## Context

Accounts exist only to store a user's projects, tools and machines (ADR-0003). Every piece of personal data we keep is a liability: it can leak, it must be protected and disclosed under privacy law (e.g. GDPR), and it erodes the trust of an open source community.

By default, Better Auth (ADR-0006) stores a `user.name` and `user.image`. `name` is a required column in Better Auth's core schema and cannot be removed. Sessions also store `ipAddress` and `userAgent`.

## Decision

The only identifying data we collect from users is their **email address**.

- The sign-up form does not ask for a name, and emails do not greet the user by name.
- A Better Auth `databaseHook` enforces this on the server, regardless of what a client sends: `user.name` is always stored as an empty string and `user.image` as `NULL`.
- A data migration cleared these fields for existing rows.
- Sessions **keep** `ipAddress` and `userAgent`. They are useful for security (spotting suspicious sessions, a future "active sessions" view) and are deleted together with the session.

Any future feature that needs additional personal data (e.g. a display name for sharing) requires a new ADR.

## Consequences

- Smaller privacy footprint and a simpler privacy policy.
- The `name` and `image` columns remain in the schema because Better Auth requires them; they are always empty.
- Session IP addresses and user agents are personal data and must be mentioned in the privacy policy.
- Third parties also process some data: Resend sees recipient addresses and email content, and Vercel sees request IPs in its logs.
