# Furrow CAM

**Open source, web-based 2.5D CAM.** Turn 2D vector designs into G-code for CNC routers, right in your browser.

**Try it at [app.furrow.cam](https://app.furrow.cam)**: no account needed, projects stay in your browser until you sign up. See the [releases](https://github.com/federicovezzoli/furrow-cam/releases) for what changed.

[![CI](https://github.com/federicovezzoli/furrow-cam/actions/workflows/ci.yml/badge.svg)](https://github.com/federicovezzoli/furrow-cam/actions/workflows/ci.yml)
[![Release](https://github.com/federicovezzoli/furrow-cam/actions/workflows/release.yml/badge.svg)](https://github.com/federicovezzoli/furrow-cam/actions/workflows/release.yml)

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

On Windows and Linux the app offers to download and install a new version itself. On macOS it tells you about it and links to the release: download it from the links above. Projects saved by a newer version may not open in an older one.

## What is it?

Furrow CAM is a Computer-Aided Manufacturing tool for **2.5D machining**: operations where the tool moves in X/Y at a series of fixed Z depths. That covers most hobby and small-shop CNC router work:

- **Profiling**: cutting parts out along a contour (inside / outside / on the line), with depth passes, ramp entry, holding tabs, dogbones at inside corners and a chosen start point
- **Pocketing**: clearing material inside closed shapes (or outside, or on the line), with offset, linear or peel strategies
- **Drilling**: plunging holes at circle centres or points, or at spots clicked in the viewport with snapping
- **Engraving**: following lines at a fixed depth, or a fixed line width with a V-bit
- **V-carving**: variable-depth carving with a V-bit, for crisp lettering and sharp corners
- **3D relief**: roughing in Z levels and parallel, waterline or spiral finishing on STL and STEP models or terrain made from a map, with rest machining for a smaller bit
- **Two-sided jobs**: flip the stock on locating pins and cut the bottom side too, with one G-code file per side

It is **not** a full 3D CAM (relief only: no undercuts, 4th axis or tool tilting), and it is not a CAD tool. You design elsewhere, import here.

## Features

- **Import** SVG and DXF drawings, several per project, then move, size, rotate, mirror, centre or fit each one to the stock; and one STL or STEP model for relief carving, in the same project, so a relief and the profile that cuts it out live together
- **Terrain from a map**: find a place, draw a rectangle, square, circle, ellipse or freehand area, preview the relief in 3D while choosing its size, exaggeration and base, and machine it like any model, with its outline as a drawing to cut it out; or download it as an STL
- **Text**: type text with bundled fonts (including a single-stroke font for engraving) or your own, then cut it or convert it into a drawing
- **Zero point** on any of the stock's 9 anchors, a typed position, or a point picked in the viewport with snapping
- **Tool library** and **machine profiles** saved to your account, with presets for popular hobby routers: V1 Engineering LowRider v4 and MPCNC Primo, Maslow 4, Sienci LongMill MK2, SainSmart Genmitsu 3018; a project offers to update its copy of a machine you have edited since
- **Preview**: toolpaths in a 2D/3D viewport, rapids and cuts shown apart, an estimated machining time per operation, plus a simulator that plays the exported G-code line by line on the stock
- **Touch-off pad** on the stock top, where the machine stops at each tool change to re-zero Z
- **G-code export** for GRBL-compatible controllers (GRBL, grblHAL, FluidNC), with optional custom start, end and tool-change blocks per machine
- **Projects** saved to your account, with undo/redo, and export/import as a file
- Metric and imperial units, light and dark theme, English, Italian, French, German, Spanish, Dutch, Portuguese, Greek, Turkish, Chinese and Japanese
- **AI assistants**: a local [MCP server](apps/mcp/README.md) lets Claude, VS Code or another MCP client import files, add operations, check toolpaths and export G-code on your `.furrow` projects, with each change showing live in the desktop app (Help → Set Up AI Assistants…)
- **Installable** from Chrome, Edge and Safari, or as a [desktop app](#desktop-app) that works offline

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
| [apps/mcp/](apps/mcp/README.md) | The MCP server: setting up an AI assistant to work on your projects |

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
pnpm demos        # record the website demo videos (needs ffmpeg)
```

### Deployment

The web app deploys to Vercel with Neon PostgreSQL ([ADR-0005](docs/adr/0005-hosting-vercel-neon.md)). Set the project's root directory to `apps/web` and configure the variables listed in [`apps/web/.env.example`](apps/web/.env.example). Vercel runs the `vercel-build` script, which generates the Prisma client (`prisma generate`) and applies pending migrations (`prisma migrate deploy`) before building, so the build does not depend on install scripts running on a cached install. With storage configured, set `CRON_SECRET` too: `apps/web/vercel.json` schedules a monthly sweep (`/api/cron/sweep-assets`) that deletes abandoned and orphaned uploads. Other hosts can call that route with `Authorization: Bearer <CRON_SECRET>`.

### Repository layout

```
apps/web/            Next.js app: routes, accounts, server code (organised by feature, ADR-0021)
apps/desktop/        Electron desktop app (ADR-0044)
apps/download/       Cloudflare Worker behind download.furrow.cam (ADR-0049)
apps/mcp/            local MCP server for AI assistants, published to npm as @furrow-cam/mcp (ADR-0067)
apps/demos/          Playwright scripts that record the website demo videos (ADR-0075)
packages/workspace/  the CAM workspace UI shared by web and desktop
packages/ui/         shadcn/ui components
packages/document/   project document schema (Zod), migrations and machine presets
packages/cam-core/   framework-agnostic geometry and toolpath generation
packages/post/       post-processors (toolpaths → G-code)
docs/                PRDs and ADRs
```

See [ADR-0011](docs/adr/0011-monorepo-structure-and-tooling.md) for the reasoning and the rules between packages.

## Contributing

The most useful contributions right now:

- **Try it on your machine** and [open an issue](https://github.com/federicovezzoli/furrow-cam/issues) for anything that cuts wrong or is confusing.
- **Machine presets**: add your router to `packages/document/src/presets/machine-presets.ts`, with a source for every value.
- **Feedback on the docs**: [PRDs](docs/prd/) say what we build and why, [ADRs](docs/adr/) how and why we build it that way.

Work is tracked in [GitHub issues](https://github.com/federicovezzoli/furrow-cam/issues), grouped into the [MVP](https://github.com/federicovezzoli/furrow-cam/milestone/1) and [Post-MVP](https://github.com/federicovezzoli/furrow-cam/milestone/2) milestones. For code changes:

1. Branch off `dev` as `<type>/issue-<number>` (`feat`, `fix` or `chore`), e.g. `feat/issue-9`.
2. Open a PR to `dev` (the default branch) with `Closes #<number>` and a changeset (`pnpm changeset`) if the change affects behaviour.
3. Releases are cut by merging `dev` into `main`; see [ADR-0012](docs/adr/0012-ci-and-releases.md).

## License

[MIT](LICENSE) © 2026 Federico Vezzoli
