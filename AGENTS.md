# Furrow CAM: agent guide

Open source, web-based 2.5D CAM for CNC routers: import SVG/DXF, define operations (profile, pocket, drill), preview toolpaths, export G-code. Scope and requirements: [docs/prd/0001-mvp.md](docs/prd/0001-mvp.md). Every architectural decision is an ADR in [docs/adr/](docs/adr/README.md); read the relevant ones before changing an area. Work is tracked in GitHub issues (milestone "MVP").

## Commands

```sh
pnpm install                  # also runs `prisma generate` in apps/web
pnpm db:up                    # local PostgreSQL 18 (docker compose)
pnpm db:migrate               # prisma migrate dev (local database only)
pnpm dev                      # http://localhost:3000

pnpm check:fix && pnpm check  # Biome lint + format (no ESLint/Prettier)
pnpm typecheck
pnpm test                     # Vitest in packages/* and apps/web (stores)
pnpm build
pnpm changeset                # add a changeset for behaviour changes
```

All four checks (`check`, `typecheck`, `test`, `build`) must pass before work is done; CI runs the same.

## Layout and dependency rules (ADR-0011)

```
apps/web/            Next.js 16: UI, viewport, server actions, Prisma, Better Auth
packages/document/   project document Zod schema + version migrations
packages/cam-core/   geometry (Clipper2 adapter) and toolpaths
packages/post/       post-processors, toolpaths → G-code
```

- Dependency direction: `web → post → cam-core → document`.
- `packages/*` must not import React, Next.js or three.js (Biome enforces it). They are consumed as TypeScript source; keep them worker-safe (no DOM).

## Architecture rules

- **CAM runs in the browser**, in Web Workers (ADR-0004). The server never computes toolpaths or G-code; it only authenticates, stores and validates.
- **Persistence (ADR-0003):** relational tables for users, tools, machines and project metadata; each project's contents are one versioned JSON document (`Project.document`, `jsonb`) validated by the Zod schema in `@furrow/document`. Tools and machines are *snapshotted* into the document when used. Toolpaths are derived data and never stored.
- **Units:** millimetres internally (`float64`); convert only at the UI edge.
- **UI:** shadcn/ui on Radix + Tailwind (ADR-0009), Zustand + Immer with patch-based undo (ADR-0010), three.js via React Three Fiber (ADR-0008).
- **Privacy (ADR-0013):** the only personal data we collect is the email address. `user.name` always mirrors the email, `user.image` is always `NULL` (enforced by hooks in `apps/web/src/lib/auth.ts`). Any new personal data needs a new ADR.

## Database and environment

- `apps/web/.env` is for local dev and points at the Docker database. `apps/web/.env.neon` holds the Neon production URLs (pooled `DATABASE_URL`, direct `DIRECT_URL`) for copying into Vercel; the app never reads it. **Never run `prisma migrate dev` against Neon**; production uses `prisma migrate deploy` (Vercel's `vercel-build` script).
- Schema changes: edit `apps/web/prisma/schema.prisma`, then `pnpm --filter @furrow/web exec prisma migrate dev --name <name>`. Never edit a migration that has been applied anywhere; add a new one.
- The four Better Auth models are generated: `pnpm dlx auth@<better-auth version> generate --config src/lib/auth.ts` (run in `apps/web`).
- Environment variables are validated by `apps/web/src/env.ts`; a new variable must also be added to `turbo.json` (`build.env`, Turborepo strict mode), `.env.example` and the CI placeholders in `.github/workflows/ci.yml` if the build needs it.
- Without `RESEND_API_KEY`, emails are printed to the dev server console.

## Conventions

- Branches: `<type>/issue-<n>` off `dev` (`feat`, `fix`, `chore`). PRs go to `dev`, never `main` (`main` is the default branch, so pass `--base dev`). Releases: merge `dev` into `main`; Changesets opens a version PR (ADR-0012).
- Commits: one short line, conventional prefix (`feat:`, `fix:`, `chore:`, `ci:`, `docs:`, `test:`), split by concern.
- Changesets for every behaviour change, bumping the affected `@furrow/*` packages.
- Docs: accepted ADRs are not edited; write a new ADR that supersedes them. Update the PRD when requirements change.
- English everywhere (public repo).

## Gotchas

- **Prisma is pinned to 7.x**: Better Auth does not support Prisma 8 yet, and npm's `latest` tag may point at a Prisma 8 release candidate.
- **three.js is pinned to 0.182** (with `@types/three`): React Three Fiber 9 creates a `THREE.Clock`, which r183 deprecated, so newer releases log a warning on every page load. Lift the pin with R3F 10.
- **Next.js 16**: `proxy.ts` replaces `middleware.ts`; with `cacheComponents` enabled, request data (`headers()`, `cookies()`, sessions) must be read inside `<Suspense>`. Read `apps/web/node_modules/next/dist/docs/` for current APIs (see `apps/web/AGENTS.md`).
- **Turborepo strict env mode** hides undeclared environment variables from tasks.
- `prisma init` and similar CLIs may drop AI-agent skill folders (`.agents/`, `.claude/`, `.windsurf/`) into a package; delete them.
- `AGENTS.md` files contain blocks managed by Turborepo and Next.js; leave those blocks intact.

<!-- BEGIN:turborepo-agent-rules -->

# This is NOT the Turborepo you know

Turborepo configuration, task behavior, and CLI commands can vary between installed versions and may differ from your training data. Resolve the `turbo` package from this file's directory or relevant workspace; in monorepos, it may not be visible from the repository root. For example, run `node -p "require.resolve('turbo/package.json')"` from a workspace that depends on `turbo`.

Read `docs/README.md` inside that installed package first, then read the relevant pages from its `docs/` directory before changing Turborepo configuration or commands. Heed deprecation notices. These bundled docs match the installed package version and are available without network access.

This block is written and re-added by `turbo` before repository-scoped commands when an AI agent is detected. In the Turborepo source repository, its template is defined in `crates/turborepo-cli/src/cli/agent_guidance.rs`. Removing the managed block while updates are enabled means a later qualifying invocation will add it again. Set `"agentGuidance": false` in the root `turbo.json` or `turbo.jsonc` to opt out; this does not remove an existing block. Keep the block committed with your work to avoid an uncommitted change on the next agent invocation.
<!-- END:turborepo-agent-rules -->
