# Architecture Decision Records

An ADR captures one significant architectural decision, along with its context and consequences. We use a lightweight format based on [Michael Nygard's template](https://cognitect.com/blog/2011/11/15/documenting-architecture-decisions).

## Process

1. Copy [`0000-template.md`](0000-template.md) to `NNNN-short-title.md` using the next free number.
2. Set status to **Proposed** and open a PR. Discussion happens on the PR.
3. When merged, set status to **Accepted**.
4. ADRs are immutable once accepted. To change a decision, write a new ADR and mark the old one **Superseded by ADR-NNNN**.

Statuses: `Proposed` · `Accepted` · `Rejected` · `Deprecated` · `Superseded by ADR-NNNN`

## Index

| # | Title | Status |
| --- | --- | --- |
| [0001](0001-record-architecture-decisions.md) | Record architecture decisions | Accepted |
| [0002](0002-nextjs-typescript-app-framework.md) | Next.js + TypeScript as application framework | Accepted |
| [0003](0003-server-persistence-prisma-postgres.md) | Server-side persistence with Prisma and PostgreSQL | Accepted |
| [0004](0004-client-side-cam-computation.md) | CAM computation runs client-side | Accepted |
| [0005](0005-hosting-vercel-neon.md) | Hosting on Vercel with Neon Postgres | Accepted |
| [0006](0006-authentication-better-auth.md) | Authentication with Better Auth, starting with email and password | Accepted |
| [0007](0007-geometry-kernel-clipper2.md) | Geometry kernel based on Clipper2 | Accepted |
| [0008](0008-rendering-threejs-r3f.md) | Rendering with three.js via React Three Fiber | Accepted |
| [0009](0009-ui-shadcn-tailwind.md) | UI components with shadcn/ui and Tailwind CSS | Accepted |
| [0010](0010-state-management-zustand.md) | Client state management with Zustand and Immer | Accepted |
| [0011](0011-monorepo-structure-and-tooling.md) | Monorepo structure and tooling | Accepted |
| [0012](0012-ci-and-releases.md) | CI with GitHub Actions and releases with Changesets | Accepted |
| [0013](0013-data-minimisation.md) | Data minimisation for user accounts | Accepted |
