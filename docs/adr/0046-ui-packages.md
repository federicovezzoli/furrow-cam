# ADR-0046: UI packages may use React

- **Status:** Proposed
- **Date:** 2026-10-18
- **Deciders:** Federico Vezzoli
- **Related:** PRD-0007, ADR-0004, ADR-0008, ADR-0009, ADR-0011, ADR-0021, ADR-0044, ADR-0045; #184

## Context

ADR-0011 forbids `react`, `react-dom`, `next` and `three` in every package, so that `document`, `cam-core` and `post` stay framework-agnostic and worker-safe. The workspace (components, stores, hooks, workers) therefore lives in `apps/web/src/features/workspace` (ADR-0021).

The desktop app (ADR-0044) mounts the same workspace. With the storage interface (ADR-0045), the workspace no longer depends on Next.js or the server. It still depends on the shared UI in `apps/web/src/components` (shadcn/ui, `number-field`, `form-error`, `local-date`, `theme-toggle`) and `lib/utils`, and on a few files in other features (tool and machine labels and forms).

## Options considered

1. **`apps/desktop` imports `apps/web/src` by path.** No new package, but couples two apps, and the web app's path aliases, Biome rules and folder conventions would apply inside another app.
2. **UI packages.** A second kind of package that may use React and three.js, kept apart from the worker-safe ones by tooling.

## Decision

We will use option 2. This supersedes ADR-0011's rule that no package may depend on React or three.js; the rest of ADR-0011 stands.

- **Two kinds of packages.**
  - **Core packages:** `document`, `cam-core`, `post`. ADR-0011's rules stay: no `react`, `react-dom`, `next` or `three`, and no DOM.
  - **UI packages:** `packages/ui` (the shadcn/ui components, `cn` and the other shared components) and `packages/workspace` (the workspace: components, stores, hooks, providers, workers, and the tool and machine pieces it uses). They may depend on React, three.js, Radix, Zustand and Immer. They must not depend on `next`; this keeps them usable from Vite.
- **Dependency direction:** `web → workspace → ui`, `desktop → workspace → ui`, `workspace → post → cam-core → document`. Core packages never import UI packages.
- **Enforcement.** Biome's `noRestrictedImports` overrides list the core packages by path instead of `packages/**`, and a second override forbids `next` in UI packages. Workers in `packages/workspace` import only core packages.
- **Consumption.** UI packages are consumed as TypeScript source like the others: `transpilePackages` in Next.js, plain imports in Vite. Each app's Tailwind entry adds the UI packages with `@source`.
- **shadcn/ui.** `components.json` moves to `packages/ui`, so `shadcn add` writes there.

## Consequences

- One copy of the workspace serves both apps.
- `apps/web/src/features/workspace` and `apps/web/src/components/ui` move to packages. ADR-0021's feature folders still describe the rest of the web app.
- Imports from `@/components/ui/*` become `@furrow/ui/*` across the web app, a large but mechanical change.
- Follow-up: update the layout and dependency rules in `AGENTS.md`.
