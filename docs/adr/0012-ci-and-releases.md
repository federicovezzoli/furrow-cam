# ADR-0012: CI with GitHub Actions and releases with Changesets

- **Status:** Accepted
- **Date:** 2026-10-08
- **Deciders:** Federico Vezzoli
- **Related:** ADR-0005, ADR-0011

## Context

Every change should be linted, typechecked, tested and built automatically. We also want versioned releases with changelogs for the web app and the internal packages, without manual version bumping. Deployment of the web app is handled by Vercel's Git integration (ADR-0005) and is not part of CI.

## Options considered

**Release tooling**

1. **Changesets**: each PR adds a small markdown file describing the change and its semver bump; a bot PR aggregates them into version bumps and changelogs. Designed for monorepos; per-package versions; supports private packages.
2. **release-please**: derives versions from Conventional Commit messages. Less explicit; commit discipline becomes load-bearing; monorepo setup is heavier.
3. **semantic-release**: commit-driven, single-package oriented; monorepo support needs plugins.

## Decision

### CI (`.github/workflows/ci.yml`)

Runs on every pull request and on pushes to `main` and `dev`: install with a frozen lockfile, then `biome ci`, `typecheck`, `test` and `build` via Turborepo.

### Releases (`.github/workflows/release.yml`)

- **Changesets** manages versions and changelogs (`@changesets/changelog-github` for PR and author links).
- Branch flow: feature branches → `dev` → `main`. Releases are cut from `main` only.
- On push to `main`, `changesets/action` either opens/updates a **"chore: version packages"** PR (when changesets are pending), or, after that PR is merged, **creates a git tag and a GitHub Release per bumped package**.
- All `@furrow/*` packages are **private**: nothing is published to npm. Publishing a package later only requires removing `"private": true` from it and adding an npm token.
- Dependabot keeps GitHub Actions and npm dependencies up to date.

## Consequences

- Every PR that changes behaviour must include a changeset (`pnpm changeset`); docs-only or CI-only PRs may skip it.
- Versions and changelogs are reviewable in the version PR before release.
- The repository setting "Allow GitHub Actions to create and approve pull requests" must be enabled.
- PRs opened by the default `GITHUB_TOKEN` do not trigger other workflows, so CI does not run automatically on the version PR. Acceptable, since it only changes versions and changelogs; a GitHub App token can be added later if needed.
