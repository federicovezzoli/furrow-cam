# @furrow/web

## 0.3.0

### Minor Changes

- [`9e8c083`](https://github.com/federicovezzoli/furrow-cam/commit/9e8c083ffc0cfd0a79357576112cc5fd9a876b82) Thanks [@federicovezzoli](https://github.com/federicovezzoli)! - Add accounts: PostgreSQL via Prisma, email and password sign-up with email verification and password reset (Better Auth + Resend), and a protected projects page.

- [`99256ed`](https://github.com/federicovezzoli/furrow-cam/commit/99256edf0b75517a91abbf57252df1c6da1ec858) Thanks [@federicovezzoli](https://github.com/federicovezzoli)! - Stop collecting names: sign-up asks only for email and password, the stored name always mirrors the email, and avatars are cleared.

- [`a447e8b`](https://github.com/federicovezzoli/furrow-cam/commit/a447e8b7b10bb87d77b7f21a39512ab2c3fd61d9) Thanks [@federicovezzoli](https://github.com/federicovezzoli)! - Add a per-user tool library: `Tool` table and migrations, server actions to list, create, update and delete tools and pick the default one (validated with the shared `Tool` schema), and a `/tools` page ("Bits library") showing them as a table, with drawings of each bit type in the table and the type picker. Each tool has a colour, and one tool can be the default. New accounts start with a 6 mm 2-flute upcut flat end mill as their default. Operations will store a snapshot of the tool, so editing the library never changes existing projects.

### Patch Changes

- Updated dependencies [[`4ef3212`](https://github.com/federicovezzoli/furrow-cam/commit/4ef3212b7d2e39e4464c5450a004a94af041548d), [`6c780c9`](https://github.com/federicovezzoli/furrow-cam/commit/6c780c9a782ecc3c4d79e17e726ddfe3659a1499)]:
  - @furrow/document@0.2.0
  - @furrow/cam-core@0.1.1
  - @furrow/post@0.1.1

## 0.2.0

### Minor Changes

- [`8a216ca`](https://github.com/federicovezzoli/furrow-cam/commit/8a216ca33f3310d54db1d8236c435f7a870b6e06) Thanks [@federicovezzoli](https://github.com/federicovezzoli)! - Initial monorepo scaffold: Next.js app, project document schema, unit helpers and empty post-processor package.

### Patch Changes

- Updated dependencies [[`8a216ca`](https://github.com/federicovezzoli/furrow-cam/commit/8a216ca33f3310d54db1d8236c435f7a870b6e06)]:
  - @furrow/document@0.1.0
  - @furrow/cam-core@0.1.0
  - @furrow/post@0.1.0
