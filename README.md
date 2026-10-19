# Furrow CAM

**Open source, web-based 2.5D CAM.** Turn 2D vector designs into G-code for CNC routers, right in your browser.

**Try it at [app.furrow.cam](https://app.furrow.cam)** (free account, email and password).

> **Status: alpha.** The MVP features are live and usable, but expect rough edges, and check your G-code in a simulator before the first cut on a new setup. See the [releases](https://github.com/federicovezzoli/furrow-cam/releases) for what changed.

## Desktop app

Furrow CAM also runs as a desktop app for macOS, Windows and Linux. It works offline with no account, and saves projects as `.furrow` files on your computer, versions included. A `.furrow` file also opens in the web app (Import), and a web export opens in the desktop app.

**Download the newest version:**

| System | Download |
| --- | --- |
| macOS, Apple Silicon (M1 and later) | [download.furrow.cam/mac-arm64](https://download.furrow.cam/mac-arm64) (`.dmg`) |
| macOS, Intel | [download.furrow.cam/mac-x64](https://download.furrow.cam/mac-x64) (`.dmg`) |
| Windows | [download.furrow.cam/win](https://download.furrow.cam/win) (`.exe`) |
| Linux | [download.furrow.cam/linux-appimage](https://download.furrow.cam/linux-appimage) (`.AppImage`), [download.furrow.cam/linux-deb](https://download.furrow.cam/linux-deb) (`.deb`) for Debian and Ubuntu, or [download.furrow.cam/linux-pacman](https://download.furrow.cam/linux-pacman) (`.pacman`) for Arch |

Older versions are on the [desktop releases](https://github.com/federicovezzoli/furrow-cam/releases?q=%40furrow%2Fdesktop&expanded=true) page.

The installers aren't code-signed, so your system warns you the first time you open the app:

- **macOS**: "Furrow CAM can't be opened because Apple cannot check it for malicious software." Open **System Settings → Privacy & Security**, scroll down to the message about Furrow CAM and click **Open Anyway**, then confirm. Alternatively, run `xattr -dr com.apple.quarantine "/Applications/Furrow CAM.app"` in Terminal.
- **Windows**: SmartScreen shows "Windows protected your PC". Click **More info**, then **Run anyway**.
- **Linux**: make the AppImage executable (`chmod +x furrow-cam-*.AppImage`) and run it, or install the `.deb` with `sudo apt install ./furrow-cam-*.deb`, or the `.pacman` package on Arch with `sudo pacman -U furrow-cam-*.pacman`. On Arch, the AppImage needs `fuse2`.

There's no automatic update: download new versions from the links above. Projects saved by a newer version may not open in an older one.

## What is it?

Furrow CAM is a Computer-Aided Manufacturing tool for **2.5D machining**: operations where the tool moves in X/Y at a series of fixed Z depths. That covers most hobby and small-shop CNC router work:

- **Profiling**: cutting parts out along a contour (inside / outside / on the line), with depth passes, ramp entry and holding tabs
- **Pocketing**: clearing material inside closed shapes, with offset, linear or peel strategies
- **Drilling**: plunging holes at circle centres or points
- **Engraving**: following lines at a fixed depth, or a fixed line width with a V-bit
- **V-carving**: variable-depth carving with a V-bit, for crisp lettering and sharp corners

It is **not** a full 3D CAM (no surface finishing of freeform models; STL relief machining is being scoped in [#101](https://github.com/federicovezzoli/furrow-cam/issues/101)), and it is not a CAD tool. You design elsewhere, import here.

## Features

- **Import** SVG and DXF drawings
- **Zero point** on any of the stock's 9 anchors, a typed position, or a point picked in the viewport with snapping
- **Tool library** and **machine profiles** saved to your account, with presets for popular hobby routers: V1 Engineering LowRider v4 and MPCNC Primo, Maslow 4, Sienci LongMill MK2, SainSmart Genmitsu 3018
- **Preview**: toolpaths in a 2D/3D viewport, rapids and cuts shown apart, plus a simulation of the stock after cutting
- **G-code export** for GRBL-compatible controllers (GRBL, grblHAL, FluidNC), with optional custom start, end and tool-change blocks per machine
- **Projects** saved to your account, with undo/redo, and export/import as a file
- Metric and imperial units, light and dark theme

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
pnpm email:dev    # preview the email templates
pnpm test         # unit tests (Vitest)
pnpm typecheck    # TypeScript across all packages
pnpm check        # lint + format check (Biome); pnpm check:fix to apply fixes
pnpm build        # production build
pnpm db:studio    # browse the database (Prisma Studio)
```

### Deployment

The web app deploys to Vercel with Neon PostgreSQL ([ADR-0005](docs/adr/0005-hosting-vercel-neon.md)). Set the project's root directory to `apps/web` and configure the variables listed in [`apps/web/.env.example`](apps/web/.env.example). Vercel runs the `vercel-build` script, which generates the Prisma client (`prisma generate`) and applies pending migrations (`prisma migrate deploy`) before building, so the build does not depend on install scripts running on a cached install. With storage configured, set `CRON_SECRET` too: `apps/web/vercel.json` schedules a monthly sweep (`/api/cron/sweep-assets`) that deletes abandoned and orphaned uploads. Other hosts can call that route with `Authorization: Bearer <CRON_SECRET>`.

### Repository layout

```
apps/web/            Next.js app: UI, viewport, server code (organised by feature, ADR-0021)
packages/document/   project document schema (Zod), migrations and machine presets
packages/cam-core/   framework-agnostic geometry and toolpath generation
packages/post/       post-processors (toolpaths → G-code)
docs/                PRDs and ADRs
```

See [ADR-0011](docs/adr/0011-monorepo-structure-and-tooling.md) for the reasoning and the rules between packages.

## Contributing

The most useful contributions right now:

- **Try it on your machine** and [open an issue](https://github.com/federicovezzoli/furrow-cam/issues) for anything that cuts wrong or is confusing.
- **Machine presets**: add your router to `packages/document/src/machine-presets.ts`, with a source for every value.
- **Feedback on the docs**: [PRDs](docs/prd/) say what we build and why, [ADRs](docs/adr/) how and why we build it that way.

Work is tracked in [GitHub issues](https://github.com/federicovezzoli/furrow-cam/issues), grouped into the [MVP](https://github.com/federicovezzoli/furrow-cam/milestone/1) and [Post-MVP](https://github.com/federicovezzoli/furrow-cam/milestone/2) milestones. For code changes:

1. Branch off `dev` as `<type>/issue-<number>` (`feat`, `fix` or `chore`), e.g. `feat/issue-9`.
2. Open a PR to `dev` (the default branch) with `Closes #<number>` and a changeset (`pnpm changeset`) if the change affects behaviour.
3. Releases are cut by merging `dev` into `main`; see [ADR-0012](docs/adr/0012-ci-and-releases.md).

## License

[MIT](LICENSE) © 2026 Federico Vezzoli
