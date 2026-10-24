# Furrow CAM: agent guide

Open source, web-based 2.5D CAM for CNC routers: import SVG/DXF, define operations (profile, pocket, drill), preview toolpaths, export G-code. Scope and requirements: [docs/prd/0001-mvp.md](docs/prd/0001-mvp.md). Every architectural decision is an ADR in [docs/adr/](docs/adr/README.md); read the relevant ones before changing an area. Work is tracked in GitHub issues (milestone "MVP").

## Commands

```sh
pnpm install                  # also runs `prisma generate` in apps/web
pnpm db:up                    # local PostgreSQL 18 and S3 storage (docker compose)
pnpm db:migrate               # prisma migrate dev (local database only)
pnpm dev                      # http://localhost:3000
pnpm email:dev                # preview email templates (apps/web/src/emails) at :3001

pnpm check:fix && pnpm check  # Biome lint + format (no ESLint/Prettier)
pnpm typecheck
pnpm test                     # Vitest in packages/* and apps/web (src/**/*.test.ts)
pnpm build
pnpm changeset                # add a changeset for behaviour changes
```

All four checks (`check`, `typecheck`, `test`, `build`) must pass before work is done; CI runs the same.

## Layout and dependency rules (ADR-0011, ADR-0046)

```
apps/web/             Next.js 16: routes, server actions, Prisma, Better Auth, the web WorkspaceHost
apps/desktop/         Electron + Vite: start screen, .furrow files, the desktop WorkspaceHost (ADR-0044)
apps/download/        Cloudflare Worker: download.furrow.cam/<platform> → newest desktop installer (ADR-0049)
packages/document/    project document Zod schema + version migrations, project archives
packages/cam-core/    geometry (Clipper2 adapter) and toolpaths
packages/post/        post-processors, toolpaths → G-code
packages/ui/          shadcn/ui (components/ui/, components.json), cn, shared components and hooks
packages/workspace/   the CAM workspace: components, stores, hooks, providers, workers, tool form, tour
```

- Dependency direction: `web → workspace → ui`, `desktop → workspace → ui`, `workspace → post → cam-core → document`.
- **Core packages** (`document`, `cam-core`, `post`) must not import React, Next.js or three.js (Biome enforces it). Keep them worker-safe (no DOM).
- **UI packages** (`ui`, `workspace`) may use React, three.js, Radix, Zustand and Immer, but never `next`, so the desktop app can use them (Biome enforces it). Inside them, import with relative paths; across packages, by subpath (`@furrow/ui/components/ui/button`, `@furrow/workspace/lib/workspace-host`). Workers in `workspace/src/workers/` import only core packages and plain modules.
- The workspace saves, loads and navigates only through its `WorkspaceHost` (ADR-0045); the web app's host is `apps/web/src/features/workspace/host/`, the desktop app's `apps/desktop/src/renderer/src/desktop-host.tsx`.
- **Desktop app (ADR-0044, ADR-0047):** the main process (`src/main/`) owns windows, menus, dialogs and every file; the renderer reaches it only through the typed preload API (`src/shared/api.ts`). The renderer has no network: a CSP and a request filter block it. `pnpm --filter @furrow/desktop dev` runs it; `dist` builds installers. Launching Electron from a VS Code terminal needs `ELECTRON_RUN_AS_NODE` unset.
- All packages are consumed as TypeScript source (`transpilePackages` in `next.config.ts`); Tailwind scans the UI packages through `@source` in `globals.css`. Run `shadcn add` in `packages/ui`.
- **Component tests** are `*.test.tsx` files beside the component in `packages/workspace`, starting with `// @vitest-environment jsdom` and rendering through `renderWorkspace` (`src/test-render.tsx`: English messages, dialogs, the stores, an in-memory `WorkspaceHost`). `pnpm test` runs them with the other tests; `pnpm --filter @furrow/workspace exec vitest run <file>` runs one.
- `cam-core/src` is grouped by layer (ADR-0037): `units/` and `geometry/` (the Clipper2 and Delaunator adapters, pure helpers) import no other folder; `import/`, `scene/`, `simulation/`, `text/` (fonts, ADR-0060) and `toolpaths/` build on them. `index.ts` is the only barrel and the public API.

Inside `apps/web/src` (ADR-0021):

```
app/              routes only (page, layout, error, route files) rendering feature components
features/<name>/  auth, tools, machines, projects, assets, onboarding, workspace (its host only):
                  actions.ts (server actions only), server.ts ("server-only" logic), components/ lib/
components/       shared web-only UI; lib/, hooks/: shared, feature-agnostic code
```

- Nothing outside `app/` imports `@/app/*`; `components/`, `lib/`, `hooks/` never import `@/features/*` (Biome enforces both). Features import each other's files directly, no barrel `index.ts`.

## Architecture rules

- **CAM runs in the browser**, in Web Workers (ADR-0004). The server never computes toolpaths or G-code; it only authenticates, stores and validates.
- **Persistence (ADR-0003):** relational tables for users, tools, machines and project metadata; each project's contents are one versioned JSON document (`Project.document`, `jsonb`) validated by the Zod schema in `@furrow/document`. Tools and machines are *snapshotted* into the document when used. Toolpaths are derived data and never stored.
- **Units:** millimetres internally (`float64`); convert only at the UI edge.
- **UI:** shadcn/ui on Radix + Tailwind (ADR-0009, in `packages/ui`), Zustand + Immer with patch-based undo (ADR-0010), three.js via React Three Fiber (ADR-0008).
- **Privacy (ADR-0013):** the only personal data we collect is the email address. `user.name` always mirrors the email, `user.image` is always `NULL` (enforced by hooks in `apps/web/src/features/auth/auth.ts`). Any new personal data needs a new ADR.

## Database and environment

- `apps/web/.env` is for local dev and points at the Docker database. `apps/web/.env.neon` holds the Neon production URLs (pooled `DATABASE_URL`, direct `DIRECT_URL`) for copying into Vercel; the app never reads it. **Never run `prisma migrate dev` against Neon**; production uses `prisma migrate deploy` (Vercel's `vercel-build` script).
- Schema changes: edit `apps/web/prisma/schema.prisma`, then `pnpm --filter @furrow/web exec prisma migrate dev --name <name>`. Never edit a migration that has been applied anywhere; add a new one.
- The four Better Auth models are generated: `pnpm dlx auth@<better-auth version> generate --config src/features/auth/auth.ts` (run in `apps/web`).
- Environment variables are validated by `apps/web/src/env.ts`; a new variable must also be added to `turbo.json` (`build.env`, Turborepo strict mode), `.env.example` and the CI placeholders in `.github/workflows/ci.yml` if the build needs it.
- Without `RESEND_API_KEY`, emails are printed to the dev server console.

## Conventions

- Branches: `<type>/issue-<n>` off `dev` (`feat`, `fix`, `chore`). PRs go to `dev` (the default branch), never `main`. Write `Closes #<n>` in the PR body so GitHub closes the issue when the PR merges. Releases: merge `dev` into `main`; Changesets opens a version PR (ADR-0012).
- Commits: one short line, conventional prefix (`feat:`, `fix:`, `chore:`, `ci:`, `docs:`, `test:`), split by concern.
- Changesets for every behaviour change, bumping the affected `@furrow/*` packages. A changeset is a release note for users: one or two sentences on what changed, no implementation details or lists of new exports (those go in the PR description). See ADR-0027.
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
