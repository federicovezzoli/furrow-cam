# Furrow CAM

**Open source, web-based 2.5D CAM.** Turn 2D vector designs into G-code for CNC routers, right in your browser.

> ⚠️ **Status: pre-alpha / design phase.** There is no usable software yet. We are currently defining scope and architecture. See [docs/](docs/).

## What is it?

Furrow CAM is a Computer-Aided Manufacturing tool for **2.5D machining**: operations where the tool moves in X/Y at a series of fixed Z depths. That covers most hobby and small-shop CNC router work:

- **Profiling**: cutting parts out along a contour (inside / outside / on-line, with tabs)
- **Pocketing**: clearing material inside a closed shape
- **Drilling**: plunging holes at points or circle centers
- **Engraving / V-carving**: following lines, or variable-depth carving with V-bits *(planned)*

It is **not** a full 3D CAM (no surface finishing of freeform models), and it is not a CAD tool. You design elsewhere, import here.

## Goals

- **Runs in the browser**: no install, works on any OS.
- **Your workshop, everywhere**: projects, tool library and machine profiles saved to your account.
- **Fast feedback**: all toolpath computation happens in your browser, instantly.
- **Correct, predictable toolpaths**: what you preview is what the machine cuts.
- **Hackable**: clear architecture, documented decisions, pluggable post-processors.

## Documentation

| Folder | Contents |
| --- | --- |
| [docs/prd/](docs/prd/) | Product Requirements Documents: *what* we build and *why* |
| [docs/adr/](docs/adr/) | Architecture Decision Records: *how* we build it and the reasoning behind each choice |

## Development

Requirements: Node.js 24 (see `.nvmrc`), pnpm 11 (`corepack enable`) and Docker.

```sh
pnpm install
cp apps/web/.env.example apps/web/.env   # then set BETTER_AUTH_SECRET (openssl rand -base64 32)
pnpm db:up        # start local PostgreSQL (docker compose)
pnpm db:migrate   # apply database migrations
pnpm dev          # start the web app at http://localhost:3000
```

Without `RESEND_API_KEY`, verification and password reset emails are printed to the dev server console.

Other commands:

```sh
pnpm test         # unit tests (Vitest)
pnpm typecheck    # TypeScript across all packages
pnpm check        # lint + format check (Biome); pnpm check:fix to apply fixes
pnpm build        # production build
pnpm db:studio    # browse the database (Prisma Studio)
```

### Deployment

The web app deploys to Vercel with Neon PostgreSQL ([ADR-0005](docs/adr/0005-hosting-vercel-neon.md)). Set the project's root directory to `apps/web` and configure the variables listed in [`apps/web/.env.example`](apps/web/.env.example). Vercel runs the `vercel-build` script, which applies pending migrations (`prisma migrate deploy`) before building.

### Repository layout

```
apps/web/            Next.js app: UI, viewport, server code
packages/document/   project document schema (Zod) and migrations
packages/cam-core/   framework-agnostic geometry and toolpath generation
packages/post/       post-processors (toolpaths → G-code)
docs/                PRDs and ADRs
```

See [ADR-0011](docs/adr/0011-monorepo-structure-and-tooling.md) for the reasoning and the rules between packages.

## Contributing

The project is just getting started. The most useful contributions right now are feedback on the [PRDs](docs/prd/) and [ADRs](docs/adr/). Open an issue or a PR against the relevant document.

Work is tracked in [GitHub issues](https://github.com/federicovezzoli/furrow-cam/issues) under the [MVP milestone](https://github.com/federicovezzoli/furrow-cam/milestone/1). For code changes:

1. Branch off `dev` as `<type>/issue-<number>` (`feat`, `fix` or `chore`), e.g. `feat/issue-9`.
2. Open a PR to `dev` (not `main`, the default branch) with `Closes #<number>` and a changeset (`pnpm changeset`) if the change affects behaviour.
3. Releases are cut by merging `dev` into `main`; see [ADR-0012](docs/adr/0012-ci-and-releases.md).

## License

[MIT](LICENSE) © 2026 Federico Vezzoli
