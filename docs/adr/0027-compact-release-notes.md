# ADR-0027: Compact release notes

- **Status:** Proposed
- **Date:** 2026-10-15
- **Deciders:** Federico Vezzoli
- **Related:** ADR-0012

## Context

ADR-0012 generates changelogs and GitHub Releases with `@changesets/changelog-github`. Its default format prefixes every entry with the PR link, the commit link and "Thanks @author!", and lists the commits behind every internal dependency bump. With a single author the thanks and commit links add nothing, and changeset texts had grown into paragraphs listing every exported function, so releases were hard to read.

## Options considered

1. **Keep the default format**: no work, but every entry stays noisy.
2. **`changelog-github` with a `template`**: drops the commit link and the thanks, but the dependency block cannot be changed.
3. **A small wrapper in `.changeset/changelog.mjs`**: uses `changelog-github`'s release line with a template and writes its own one-line dependency entry.

## Decision

We will use option 3. Each entry is `- <summary> (#<pr>)` (the commit link when there is no PR), and a dependency bump is one line: `- Updated dependencies: @furrow/a@x.y.z, …`.

Changeset texts are release notes for users: one or two sentences on what changed, no implementation details or lists of new exports. Those belong in the PR description, which the entry links to.

This supersedes ADR-0012's choice of `changelog-github`'s default format for "PR and author links"; the rest of ADR-0012 stands.

## Consequences

- Release notes and `CHANGELOG.md` files are shorter and read as a list of changes.
- Author credit is no longer in the notes; it is in the linked PR.
- The wrapper depends on `changelog-github`'s `template` option; a breaking change there needs the wrapper updated.
