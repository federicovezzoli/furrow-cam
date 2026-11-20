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
| [0016](0016-zero-point-anchors.md) | XY zero on any stock anchor or a custom point | Accepted |
| [0017](0017-freemium-limit-enforcement.md) | Enforcing freemium usage limits | Rejected |
| [0018](0018-operations-target-paths.md) | Operations target paths, not whole shapes | Accepted; superseded in part by ADR-0080 |
| [0019](0019-heightmap-simulation.md) | Material-removal simulation with a heightmap | Accepted |
| [0020](0020-page-view-analytics-goatcounter.md) | Page-view analytics with GoatCounter | Superseded by ADR-0052 |
| [0021](0021-web-app-feature-folders.md) | Feature folders in the web app | Accepted |
| [0022](0022-drawing-aligned-to-anchor.md) | The drawing is aligned to the stock at the zero's anchor | Accepted; superseded in part by ADR-0055 |
| [0023](0023-password-policy-breached-passwords.md) | Password length limits and breached-password check | Accepted |
| [0024](0024-selection-in-the-viewport-only.md) | Paths are selected in the viewport only | Superseded by ADR-0080 |
| [0025](0025-medial-axis-sampled-voronoi.md) | Medial axis from a Voronoi diagram of boundary samples | Accepted |
| [0026](0026-operation-clearing-tool.md) | An operation may cut with a second, clearing tool | Accepted |
| [0027](0027-compact-release-notes.md) | Compact release notes | Accepted |
| [0028](0028-project-versions.md) | Named project versions stored as full documents | Accepted |
| [0029](0029-mesh-storage-s3.md) | Meshes are stored as project assets in S3-compatible storage | Accepted |
| [0030](0030-relief-toolpaths-heightmap.md) | Relief toolpaths from a model heightmap | Accepted |
| [0031](0031-model-placement.md) | Models are placed by quarter turns, a scale and a depth, and aligned with the drawing | Accepted; superseded in part by ADR-0034, ADR-0038, ADR-0055 and ADR-0060 |
| [0032](0032-relief-finishing-passes.md) | Relief finishing passes in their own frame, cancelled between slices | Accepted |
| [0033](0033-relief-roughing-levels.md) | Relief roughing clears simplified level outlines with the pocket strategies | Accepted |
| [0034](0034-model-keeps-proportions.md) | Models keep their proportions and are cut off at the stock's bottom | Accepted |
| [0035](0035-relief-rest-machining.md) | Rest machining simulates the earlier toolpaths on a coarser grid | Accepted |
| [0036](0036-guided-tour-timestamps.md) | The account remembers when each guided tour was seen | Accepted |
| [0037](0037-cam-core-layer-folders.md) | Layer folders in cam-core | Accepted; superseded in part by ADR-0065 |
| [0038](0038-roughing-margin-and-model-border.md) | Roughing can clear a margin around the model, and fitted models leave a border | Accepted; superseded in part by ADR-0064 |
| [0039](0039-waterline-and-spiral-finishing.md) | Waterline contours from a map of tip heights, spirals along rows and columns | Accepted |
| [0040](0040-steep-moves-between-samples.md) | Relief passes go over steep jumps between samples instead of cutting across them | Accepted; superseded in part by ADR-0070 and ADR-0071 |
| [0041](0041-touch-off-pad.md) | A touch-off pad of stock top that no operation cuts | Accepted; superseded in part by ADR-0043 |
| [0042](0042-gcode-simulation.md) | The G-code program is simulated from its text, with the cutter named in a comment | Accepted |
| [0043](0043-touch-off-pad-opt-in.md) | The touch-off pad is opt-in, sits on the zero, follows the design and can have its own tool change | Accepted; superseded in part by ADR-0053 |
| [0044](0044-desktop-app-electron.md) | The desktop app is an Electron shell around the shared workspace | Accepted; superseded in part by ADR-0048 and ADR-0052 |
| [0045](0045-workspace-storage-interface.md) | The workspace saves and loads through a storage interface | Accepted |
| [0046](0046-ui-packages.md) | UI packages may use React | Accepted |
| [0047](0047-local-project-files.md) | Desktop projects are `.furrow` archives that carry their versions | Accepted |
| [0048](0048-desktop-update-check.md) | The desktop app checks GitHub for newer versions and links to them | Accepted; superseded in part by ADR-0074 and ADR-0081 |
| [0049](0049-stable-download-links.md) | Stable download links from a Cloudflare Worker, counted in Analytics Engine | Accepted |
| [0050](0050-guest-workspace-in-the-browser.md) | Guests use the workspace with projects kept in the browser | Accepted |
| [0051](0051-bug-reports-as-github-issue-drafts.md) | Bug reports are prefilled GitHub issue drafts the user submits | Accepted |
| [0052](0052-usage-and-error-tracking-posthog.md) | Anonymous usage and error tracking with PostHog | Accepted |
| [0053](0053-touch-off-suggest-every-xy-move.md) | Touch-off Suggest keeps the tool on the pad through every kind of XY move | Accepted |
| [0054](0054-interface-languages.md) | Interface languages with use-intl, picked from the browser or the system | Accepted |
| [0055](0055-several-drawings-transformed-in-place.md) | A project holds several drawings, each transformed by rewriting its points | Accepted |
| [0056](0056-touch-off-tool-change-shows-what-runs.md) | The touch-off pad's tool change is always a block, and the field shows it | Accepted |
| [0057](0057-server-results-carry-message-keys.md) | What the server returns to the browser carries message keys, not text | Accepted |
| [0058](0058-step-over-per-operation.md) | Each operation sets its own step-over; tools have none | Accepted |
| [0059](0059-text-items-are-drawings-with-settings.md) | A text item is a drawing that keeps its settings and stores its outlines as one shape | Accepted |
| [0060](0060-two-sided-projects.md) | Two-sided projects flip the stock about its centre line, and the bottom side has its own stock coordinates | Accepted; superseded in part by ADR-0063 |
| [0061](0061-fonts-parsed-with-opentype-js.md) | Fonts are parsed and laid out with opentype.js, behind one adapter | Accepted |
| [0062](0062-uploaded-fonts-are-project-assets.md) | Uploaded fonts are project assets, listed in the document like models | Accepted |
| [0063](0063-two-sided-silhouette-parting-and-holding-tabs.md) | Each side cuts all of the model it can see, and two-sided holding tabs are a setting of the setup | Accepted; superseded in part by ADR-0086 |
| [0064](0064-finishing-covers-a-boundary.md) | 3D finishing covers the same boundary as roughing | Accepted |
| [0065](0065-folders-inside-packages.md) | Folders inside packages, by layer or by implementation | Accepted |
| [0066](0066-drawings-store-their-rotation.md) | Drawings store their rotation, which the angle field shows and sets | Accepted |
| [0067](0067-local-mcp-server.md) | A local MCP server in `apps/mcp`, driving the workspace's document store headless | Accepted; superseded in part by ADR-0082 |
| [0068](0068-more-interface-languages.md) | Seven more interface languages, with one variant each | Accepted |
| [0069](0069-model-sits-below-stock-top.md) | A model's top can sit below the stock top | Accepted |
| [0070](0070-diagonal-moves-on-steep-faces.md) | Relief passes go straight down steep faces and merge within 0.02 mm | Accepted |
| [0071](0071-going-over-clears-the-whole-sub-step.md) | Relief passes go over a wall no lower than the tool anywhere along the level move | Accepted |
| [0072](0072-step-files-imported-as-stl.md) | STEP files are turned into STL on import, with OpenCascade in WebAssembly | Accepted |
| [0073](0073-no-look-between-close-samples.md) | Relief passes don't look between samples close in height | Accepted |
| [0074](0074-desktop-installs-updates.md) | The desktop app installs updates itself on Windows and Linux, through the download Worker | Accepted; superseded in part by ADR-0081 |
| [0075](0075-demo-videos-recorded-frame-by-frame.md) | Demo videos are recorded a frame at a time on a frozen page clock | Accepted |
| [0076](0076-public-map-search-and-elevation-services.md) | Maps, place search and elevation come from public services the browser calls directly | Accepted |
| [0077](0077-terrain-generated-as-stl.md) | Terrain is generated in the browser as an STL mesh and imported like one | Accepted |
| [0078](0078-drawings-and-a-model-together.md) | A project holds drawings and one model together | Accepted; superseded in part by ADR-0085 |
| [0079](0079-machine-snapshot-links-its-source.md) | A project's machine snapshot links to the library machine it came from | Accepted |
| [0080](0080-objects-then-paths.md) | Objects are selected first, their paths inside them, with an Objects pane | Accepted; superseded in part by ADR-0083 |
| [0081](0081-update-notice-opens-the-website.md) | The update notice opens the website's download section | Accepted |
| [0082](0082-mcp-terrain-fetches-elevation.md) | The MCP server makes terrain, fetching only elevation tiles while its tool runs | Accepted |
| [0083](0083-operations-and-objects-share-a-tab.md) | Operations and objects share a sidebar tab, one above the other | Accepted |
| [0084](0084-vcarve-inlays-start-depth.md) | V-carve inlays come from a start depth and a boundary path among the targets | Accepted |
| [0085](0085-several-models.md) | A project holds several models, each machined on its own | Accepted |
| [0086](0086-holding-tabs-belong-to-the-stock.md) | Holding tabs belong to the stock, so one-sided jobs have them too | Accepted |
| [0087](0087-patterns-are-drawings-anchored-to-a-boundary.md) | A pattern is a drawing that keeps its settings and its boundary, and stores its cells as one shape | Accepted; superseded in part by ADR-0088 |
| [0088](0088-pattern-panel-offers-only-its-settings.md) | A pattern is placed through its boundary and its own settings, not transformed on its own | Accepted |
