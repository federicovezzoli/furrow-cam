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
| [0011](0011-monorepo-structure-and-tooling.md) | Monorepo structure and tooling | Accepted; superseded in part by ADR-0046 |
| [0012](0012-ci-and-releases.md) | CI with GitHub Actions and releases with Changesets | Accepted |
| [0013](0013-data-minimisation.md) | Data minimisation for user accounts | Accepted |
| [0014](0014-stock-coordinates.md) | Geometry is stored in stock coordinates | Accepted |
| [0015](0015-clipper2-typescript-port.md) | Clipper2 TypeScript port (clipper2-ts) | Accepted |
| [0016](0016-zero-point-anchors.md) | XY zero on any stock anchor or a custom point | Proposed |
| [0017](0017-freemium-limit-enforcement.md) | Enforcing freemium usage limits | Proposed |
| [0018](0018-operations-target-paths.md) | Operations target paths, not whole shapes | Proposed |
| [0019](0019-heightmap-simulation.md) | Material-removal simulation with a heightmap | Proposed |
| [0020](0020-page-view-analytics-goatcounter.md) | Page-view analytics with GoatCounter | Proposed; superseded by ADR-0052 |
| [0021](0021-web-app-feature-folders.md) | Feature folders in the web app | Proposed |
| [0022](0022-drawing-aligned-to-anchor.md) | The drawing is aligned to the stock at the zero's anchor | Proposed |
| [0023](0023-password-policy-breached-passwords.md) | Password length limits and breached-password check | Proposed |
| [0024](0024-selection-in-the-viewport-only.md) | Paths are selected in the viewport only | Proposed |
| [0025](0025-medial-axis-sampled-voronoi.md) | Medial axis from a Voronoi diagram of boundary samples | Proposed |
| [0026](0026-operation-clearing-tool.md) | An operation may cut with a second, clearing tool | Proposed |
| [0027](0027-compact-release-notes.md) | Compact release notes | Proposed |
| [0028](0028-project-versions.md) | Named project versions stored as full documents | Proposed |
| [0029](0029-mesh-storage-s3.md) | Meshes are stored as project assets in S3-compatible storage | Proposed |
| [0030](0030-relief-toolpaths-heightmap.md) | Relief toolpaths from a model heightmap | Proposed |
| [0031](0031-model-placement.md) | Models are placed by quarter turns, a scale and a depth, and aligned with the drawing | Proposed |
| [0032](0032-relief-finishing-passes.md) | Relief finishing passes in their own frame, cancelled between slices | Proposed |
| [0033](0033-relief-roughing-levels.md) | Relief roughing clears simplified level outlines with the pocket strategies | Proposed |
| [0034](0034-model-keeps-proportions.md) | Models keep their proportions and are cut off at the stock's bottom | Proposed |
| [0035](0035-relief-rest-machining.md) | Rest machining simulates the earlier toolpaths on a coarser grid | Proposed |
| [0036](0036-guided-tour-timestamps.md) | The account remembers when each guided tour was seen | Proposed |
| [0037](0037-cam-core-layer-folders.md) | Layer folders in cam-core | Proposed |
| [0038](0038-roughing-margin-and-model-border.md) | Roughing can clear a margin around the model, and fitted models leave a border | Proposed |
| [0039](0039-waterline-and-spiral-finishing.md) | Waterline contours from a map of tip heights, spirals along rows and columns | Proposed |
| [0040](0040-steep-moves-between-samples.md) | Relief passes go over steep jumps between samples instead of cutting across them | Proposed |
| [0041](0041-touch-off-pad.md) | A touch-off pad of stock top that no operation cuts | Proposed; superseded in part by ADR-0043 |
| [0042](0042-gcode-simulation.md) | The G-code program is simulated from its text, with the cutter named in a comment | Proposed |
| [0043](0043-touch-off-pad-opt-in.md) | The touch-off pad is opt-in, sits on the zero, follows the design and can have its own tool change | Proposed; superseded in part by ADR-0053 |
| [0044](0044-desktop-app-electron.md) | The desktop app is an Electron shell around the shared workspace | Proposed; superseded in part by ADR-0048 and ADR-0052 |
| [0045](0045-workspace-storage-interface.md) | The workspace saves and loads through a storage interface | Proposed |
| [0046](0046-ui-packages.md) | UI packages may use React | Proposed |
| [0047](0047-local-project-files.md) | Desktop projects are `.furrow` archives that carry their versions | Proposed |
| [0048](0048-desktop-update-check.md) | The desktop app checks GitHub for newer versions and links to them | Proposed |
| [0049](0049-stable-download-links.md) | Stable download links from a Cloudflare Worker, counted in Analytics Engine | Proposed |
| [0050](0050-guest-workspace-in-the-browser.md) | Guests use the workspace with projects kept in the browser | Proposed |
| [0051](0051-bug-reports-as-github-issue-drafts.md) | Bug reports are prefilled GitHub issue drafts the user submits | Proposed |
| [0052](0052-usage-and-error-tracking-posthog.md) | Anonymous usage and error tracking with PostHog | Proposed |
| [0053](0053-touch-off-suggest-every-xy-move.md) | Touch-off Suggest keeps the tool on the pad through every kind of XY move | Proposed |
