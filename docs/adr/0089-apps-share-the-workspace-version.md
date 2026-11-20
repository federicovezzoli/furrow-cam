# ADR-0089: The web and desktop apps share the workspace's version

- **Status:** Accepted
- **Date:** 2026-11-20
- **Deciders:** Federico Vezzoli
- **Related:** ADR-0012 (supersedes its per-package versions for the apps), ADR-0027, ADR-0048

## Context

Most features land in `@furrow/workspace`, and most changesets name only that package. Changesets bumps a dependent only to keep its dependency range valid, and always as a patch (`updateInternalDependencies` has no other mode for this), so a workspace `minor` reached `@furrow/web` and `@furrow/desktop` as a patch whose release note said only "Updated dependencies". The apps are what users run, yet on `main` web was at 0.22.15 and desktop at 0.19.8 while workspace was at 0.30.0. Naming the apps in every changeset was the only workaround, and most changesets didn't.

## Options considered

1. **Link the three packages** (`linked` in `.changeset/config.json`): every package of the group being released gets the group's highest bump. They also share a version number.
2. **A CI check** that fails when a changeset bumps the workspace with `minor` or `major` without naming both apps. App versions keep their own meaning, but it needs code and still relies on every author.

## Decision

`.changeset/config.json` links `@furrow/workspace`, `@furrow/web` and `@furrow/desktop`. A workspace `minor` makes both apps `minor`, and the three move to the same version, starting from the highest of them (0.31.0 after 0.30.0). `@furrow/mcp` stays out: workspace UI features don't change it, and it still gets a patch when its dependencies change. The core and UI packages keep their own versions.

## Consequences

- A changeset may name only `@furrow/workspace` for a workspace feature; the apps follow it. A change in one app alone still names that app.
- The apps' version numbers jump once (web from 0.22, desktop from 0.19) and keep going up, so the desktop update check (ADR-0048) is unaffected.
- An app's version no longer says how much that app changed on its own; its changelog does.
