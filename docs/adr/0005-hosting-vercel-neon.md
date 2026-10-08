# ADR-0005: Hosting on Vercel with Neon Postgres

- **Status:** Accepted
- **Date:** 2026-10-08
- **Deciders:** Federico Vezzoli
- **Related:** ADR-0002, ADR-0003, ADR-0004

## Context

Furrow CAM will be deployed as a single public instance on its own domain. The app is Next.js (ADR-0002) with Prisma + PostgreSQL (ADR-0003). The server does only auth and persistence; all CAM computation is client-side (ADR-0004), so server load is light and bursty. We want low operational overhead and low cost at small scale.

## Options considered

**App hosting**

1. **Vercel**: first-party Next.js support, preview deploy per PR, zero ops. Cons: platform pricing at scale, some Vercel-specific conveniences.
2. **Netlify / Cloudflare / Fly.io / VPS**: viable, but more friction for Next.js features or more ops work.

**Database**

1. **Neon**: serverless Postgres, Vercel marketplace integration, built-in connection pooling, database branching per preview deploy, scale-to-zero. Plain Postgres, easy to migrate away.
2. **Supabase**: Postgres plus auth/storage/realtime. We would only use Postgres (auth is handled in-app, ADR-0006), so the extra platform adds lock-in pressure without benefit. Free-tier projects pause after inactivity.
3. **Turso (libSQL/SQLite)**: edge-replicated, but not Postgres (we rely on `jsonb`, ADR-0003) and Prisma support goes through a less mature adapter. Edge reads offer little benefit since computation is client-side.
4. **Prisma Postgres**: tight Prisma integration, newer and less proven.

## Decision

- Host the Next.js app on **Vercel**.
- Use **Neon** for PostgreSQL, connected through Neon's pooled connection string for serverless functions and a direct connection for Prisma migrations.
- Use a **Neon branch per Vercel preview deployment**, so PRs get an isolated database with migrations applied.
- Avoid Vercel-only APIs in application code where a portable alternative exists, so the app can be moved to another Node.js host if needed.

## Consequences

- Near-zero ops; deploys on push, previews on every PR.
- Cold starts are possible on the free tier (Neon scale-to-zero, serverless functions); acceptable for an MVP.
- Prisma must be configured for serverless (pooled URL, `directUrl` for migrations).
- Free-tier limits and pricing of both providers should be reviewed before launch and as usage grows.
