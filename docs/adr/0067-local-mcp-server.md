# ADR-0067: A local MCP server in `apps/mcp`, driving the workspace's document store headless

- **Status:** Proposed
- **Date:** 2026-10-29
- **Deciders:** Federico Vezzoli
- **Related:** ADR-0003, ADR-0004, ADR-0010, ADR-0011, ADR-0028, ADR-0044, ADR-0046, ADR-0047, ADR-0052; PRD-0012; #364

## Context

PRD-0012 asks for a Model Context Protocol server through which an AI assistant works on `.furrow` projects (M1, M2, M8), and later imports, sets up stock and tools, adds operations, checks and exports G-code (M3–M7). It must change projects exactly as the app does.

The app changes a project only through the workspace's document store (ADR-0010): `createDocumentStore` is a vanilla Zustand store with Immer patches, and every feature action (`setStockDimension`, `addImportedShapes`, the `add*Operation` actions) is a plain function over it, with no React. The desktop app reads and writes `.furrow` files with the archive helpers in `@furrow/document` and its own `readProjectFile` / `writeProjectFile` (ADR-0047). CAM runs on the user's computer (ADR-0004), which the desktop app already does outside a browser.

## Options considered

1. **A server that edits the JSON document itself**: no dependency on the workspace, but every rule the actions enforce (defaults, alignment to the stock, validation) would be written twice and drift.
2. **A server that reuses the workspace's store and actions headless**, the same code the app runs, without React.
3. **Tools inside the desktop app**, served while it runs: the assistant would depend on the app being open, and the main process would grow a second way to change projects.

## Decision

We will use option 2.

- **Where.** The server is `apps/mcp` (`@furrow/mcp`), a Node app. Dependency direction: `mcp → workspace → ui`, and the core packages (`document`, `cam-core`, `post`). It imports only the workspace's non-React modules (`stores/`, `lib/`), never its components, providers, hooks, tools or onboarding, nor `next`, React or three.js: a Biome override enforces it. Its `tsconfig.json` has no DOM library, so DOM APIs fail to typecheck.
- **SDK.** The official TypeScript SDK, `@modelcontextprotocol/sdk`, over stdio. Tool inputs are Zod schemas, as everywhere else.
- **One way to change a project.** Each open project is a workspace document store. Tools change it only through the workspace's actions, run inside `change()`, which also keeps the automatic version below. The shared `readProjectFile` / `writeProjectFile` move from the desktop app to `@furrow/workspace/lib/project-file`, so both open and save projects with the same checks and messages; their messages move from `Desktop.ProjectFile` to a top-level `ProjectFile` namespace.
- **Files.** Projects open from `.furrow`, `.furrow.zip` and `.furrow.json` by absolute path and save as `.furrow` beside them, written to a temporary file and renamed, like the desktop app's save. Saving never replaces a file that isn't the project's own, nor its own if it changed on disk since the server read or wrote it (the user saved it in the app). Open projects are found by the file they were opened from, and once saved by their `.furrow` file, so a project and its export of the same name stay apart. Changes stay in memory until a save tool is called.
- **Versions (ADR-0028).** Before the first change to an opened project in a session, the document as it was is kept as an automatic version, "Before the assistant's changes", saved with the project. A project that already has the most versions refuses the change, as the app refuses saving one more: nothing is pruned.
- **Messages.** Results and errors are in English, with the app's English messages where the app has one.
- **CAM.** Toolpaths and G-code (later tools) are computed in the server's process, on the user's computer, which ADR-0004 allows as it does for the desktop app.
- **No telemetry.** The server sends no events, anonymous or not, and makes no network requests: it answers only the assistant that started it. This settles PRD-0012's open question; ADR-0052's events cover the two apps only.

## Consequences

- A rule added to a workspace action reaches the app and the server at once; a tool that bypasses `change()` loses the automatic version, which reviews must catch.
- The workspace's `stores/` and `lib/` modules the server imports must stay free of React and the DOM; the server's typecheck and Biome override fail if they don't.
- The server is bundled with esbuild into one `dist/main.js`, since the packages are consumed as TypeScript source. It is the one `@furrow/*` package published to npm (`npx @furrow/mcp`, #369): every dependency, the private `@furrow/*` packages included, is bundled, so the published package has none, and their licences ship as `dist/THIRD-PARTY-NOTICES.txt` beside the repository's `LICENSE`. It stays `private` for Changesets, which only tags it; the release workflow then publishes it in a step of its own, allowed to fail so npm can't hold up the desktop and web releases, with npm trusted publishing (OIDC, no token, provenance included).
- The first publish, which creates `@furrow/mcp` on npm, is done by hand: from `apps/mcp`, `npm pkg delete private devDependencies && npm publish` by a maintainer of the `furrow` npm org (or once with a token). After it, set `@furrow/mcp` up on npmjs.com as a trusted publisher for this repository and `release.yml`; trusted publishing needs npm 11.5.1 or later, which Node 24 ships.
- `writeFileAtomic` exists in both the desktop main process and the server, whose copy can also refuse to replace a file even when another process creates it meanwhile (a hard link, or an exclusive copy where links aren't supported): a few lines of Node code that neither the browser-safe packages nor another app can share.
