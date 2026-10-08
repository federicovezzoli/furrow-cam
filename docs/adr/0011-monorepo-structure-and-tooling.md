# ADR-0011: Monorepo structure and tooling

- **Status:** Accepted
- **Date:** 2026-10-08
- **Deciders:** Federico Vezzoli
- **Related:** ADR-0002, ADR-0003, ADR-0004, ADR-0007

## Context

ADR-0002 and ADR-0004 require the CAM core (geometry, toolpaths, G-code) to be framework-agnostic and worker-safe: no React, Next.js or DOM imports. The project document schema (ADR-0003) must be shared by client, server and CAM core. Folder conventions alone are easy to break by accident; we want the boundaries enforced by tooling.

We also need consistent linting, formatting, testing and task running across the codebase.

## Options considered

**Structure**

1. **Single Next.js app** with folders for core code. Simple, but boundaries are only conventions.
2. **Monorepo with workspace packages**. Each package declares its own dependencies; a package that does not depend on React cannot import it.

**Lint and format**

1. **ESLint + Prettier**: the most common setup, many plugins, but two tools, more config and slower.
2. **Biome**: a single fast tool for linting and formatting, with built-in TypeScript/JSX support and import restriction rules. Fewer plugins than ESLint (e.g. no full React Hooks or Next.js rule sets).

## Decision

### Layout

```
apps/
  web/              Next.js app: UI, viewport, server code, Prisma, auth
packages/
  document/         Zod schema of the project document + schema migrations
  cam-core/         geometry adapter (Clipper2), toolpath generation
  post/             post-processors turning toolpaths into G-code (GRBL first)
docs/
  adr/  prd/
```

Dependency direction: `web → post → cam-core → document`. Packages never depend on `apps/*`.

### Tooling

- **pnpm workspaces** for package management, with strict dependency isolation.
- **Turborepo** for running tasks (`build`, `dev`, `test`, `typecheck`) across packages with caching.
- **TypeScript** in strict mode, with a shared base `tsconfig`.
- Internal packages are consumed **as TypeScript source** (no separate build step); Next.js transpiles them.
- **Biome** for linting and formatting the whole repo, with a single root config. ESLint and Prettier are not used.
- **Vitest** for unit tests in packages.

### Boundary enforcement

- `packages/*` must not list `react`, `react-dom`, `next` or `three` as dependencies; pnpm's isolation then makes such imports fail.
- Biome's `noRestrictedImports` rule additionally forbids those imports in `packages/**`, so mistakes surface in the editor and in CI.

## Consequences

- Package boundaries are enforced by tooling, not just by convention.
- One fast tool for lint and format; one command (`pnpm check`) for both.
- We lose ESLint-only rule sets (React Hooks exhaustive deps, Next.js-specific rules). Biome covers part of this; we accept the gap.
- Slightly more setup than a single app, which we accept.
