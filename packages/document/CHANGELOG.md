# @furrow/document

## 0.2.0

### Minor Changes

- [#29](https://github.com/federicovezzoli/furrow-cam/pull/29) [`4ef3212`](https://github.com/federicovezzoli/furrow-cam/commit/4ef3212b7d2e39e4464c5450a004a94af041548d) Thanks [@federicovezzoli](https://github.com/federicovezzoli)! - Define project document schema v1 (stock origin, machine snapshot, geometry with line/arc/cubic segments, operation envelope with tool snapshot), shared `Tool` and `Machine` schemas, `createProjectDocument()` and `parseProjectDocument()` with a versioned migration chain.

- [`6c780c9`](https://github.com/federicovezzoli/furrow-cam/commit/6c780c9a782ecc3c4d79e17e726ddfe3659a1499) Thanks [@federicovezzoli](https://github.com/federicovezzoli)! - Add a required `color` (`#rrggbb`) to the `Tool` schema, so tool snapshots in operations keep the colour used for their toolpaths.

## 0.1.0

### Minor Changes

- [`8a216ca`](https://github.com/federicovezzoli/furrow-cam/commit/8a216ca33f3310d54db1d8236c435f7a870b6e06) Thanks [@federicovezzoli](https://github.com/federicovezzoli)! - Initial monorepo scaffold: Next.js app, project document schema, unit helpers and empty post-processor package.
