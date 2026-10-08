# ADR-0006: Authentication with Better Auth, starting with email and password

- **Status:** Accepted
- **Date:** 2026-10-08
- **Deciders:** Federico Vezzoli
- **Related:** PRD-0001 (R17), ADR-0002, ADR-0003, ADR-0005

## Context

Users need accounts to store projects, tools and machine profiles (ADR-0003). The MVP starts with **email + password** only, but we expect to add OAuth providers (e.g. Google, GitHub), magic links, passkeys and/or 2FA later, ideally without migrating users or rewriting auth code.

Email + password requires secure password hashing, sessions, email verification and password reset. The last two require sending transactional email.

## Options considered

1. **Better Auth**: TypeScript auth library running inside our Next.js app. Email + password with verification and reset built in; OAuth, magic link, passkeys and 2FA as plugins on the same user/session model; official Prisma adapter; database sessions in our Postgres.
2. **Auth.js (NextAuth)**: mature, but the credentials provider is deliberately minimal (no sign-up, hashing or reset flow; JWT sessions only), so email + password would be largely hand-built. The project is now maintained by the Better Auth team.
3. **Hosted providers (Clerk, Supabase Auth, Auth0)**: fastest to start, but user data lives outside our database, adds vendor lock-in and per-user cost, and contradicts the choice of plain Postgres on Neon (ADR-0005).
4. **Roll our own**: full control, high security risk. Rejected.

## Decision

- Use **Better Auth** with the **Prisma adapter**, storing users, accounts and sessions in our PostgreSQL database.
- MVP enables **email + password** with **mandatory email verification** and **password reset**.
- Send transactional email via **Resend**, behind a small `sendEmail` interface so the provider can be swapped.
- Additional login methods are added later as Better Auth plugins/providers, each with its own short ADR if it changes data or flows significantly.

## Consequences

- Auth data lives in our own database; no per-user cost and no external auth vendor.
- Adding OAuth or passkeys later links extra accounts to the existing user record; no migration of users.
- We own the security configuration (rate limiting on auth routes, secure cookies, secret management) and must keep the library up to date.
- A Resend account and verified sending domain are required before launch.
