# ADR-0021: Feature folders in the web app

- **Status:** Proposed
- **Date:** 2026-10-14
- **Deciders:** Federico Vezzoli
- **Related:** ADR-0002, ADR-0003, ADR-0006, ADR-0011

## Context

ADR-0011 sets the package layout and the dependency direction between packages, but says nothing about the structure inside `apps/web/src`. Two conventions grew there side by side: some feature code lived next to its route in `app/` (the tool and machine forms, the whole workspace under `app/(workspace)/projects/[id]/`, every `actions.ts`), other code was grouped by domain under `components/` (`components/projects/`, `components/viewport/`, `components/auth/`), and `lib/`, `stores/` and `hooks/` mixed shared code with code only one feature uses.

Once a feature was needed outside its own page, code reached into another route group's private files, e.g. the workspace imported the bit form from `@/app/(app)/tools/tool-form`.

Server actions also shared files with helpers (form parsers, a row lock). Every export of a `"use server"` file is a public endpoint, so a helper exported later by mistake would become one.

## Options considered

1. **Colocate everything with routes**: feature code stays in `app/`. Shared code still has no home, and a feature used by two route groups belongs to neither.
2. **Group by kind** (`components/`, `hooks/`, `stores/`, `actions/` at the top level): one place per kind, but a feature is spread over every folder, and nothing tells shared code from feature code.
3. **Feature folders, split by kind inside**: one folder per feature, holding its components, hooks, stores and server code; shared code stays at the top level. This is the layout of our other Next.js projects.

## Decision

We will organise `apps/web/src` by feature (option 3):

```
src/app/              routes only: page, layout, error, loading and route files, rendering feature components
src/features/<name>/  one feature:
  actions.ts            server actions only
  server.ts             server-only logic, marked `import "server-only"`
  labels.ts, …          small modules shared within the feature
  components/ hooks/ providers/ stores/ lib/ workers/   only the ones the feature needs
src/components/       shared UI: ui/ (shadcn), form fields and errors, number field, theme, footer, …
src/lib/ src/hooks/   shared, feature-agnostic code: db, email, form data, downloads, lazy workers, …
```

The features are `auth`, `tools`, `machines`, `projects` and `workspace` (the project editor: panes, viewport, document stores, toolpath and simulation workers).

Import rules, enforced by Biome `noRestrictedImports`:

- Nothing outside `app/` imports from `app/`.
- `components/`, `lib/` and `hooks/` do not import from `features/`; shared code that needs a feature belongs in that feature.
- Features import each other's files directly. There is no barrel `index.ts`: it would mix server-only and client modules behind one import.

Server code:

- `actions.ts` exports only server actions (check the session, parse, call, revalidate) and types. Helpers and shared server logic (Prisma reads and writes, form parsers, snapshots) live in the feature's `server.ts`.
- Better Auth's configuration is `features/auth/auth.ts`, without `server-only`, because the Better Auth CLI loads it outside Next.js to generate the schema; it imports server-only modules lazily, inside the hooks that need them. Code reads the session through `features/auth/server.ts`.

## Consequences

- Each feature's code is found in one folder, and moving a feature between routes no longer touches its files.
- A component a second route group needs is imported from its feature, never from another route's folder.
- Server helpers can't become endpoints by being exported, and importing `server.ts` from a client component fails the build.
- Auth moved out of `lib/`: account creation seeds the default tool from `features/tools/server.ts`, which shared code may not import.
- Tests stay next to their code (`src/**/*.test.ts`). Vitest aliases `server-only` to its empty module, since tests run outside React Server Components.
