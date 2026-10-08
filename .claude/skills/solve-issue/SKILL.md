---
name: solve-issue
description: >
  Pick up an already-filed GitHub issue in furrow-cam and start work on it manually:
  fetch the issue, sync `dev`, create a `<type>/issue-<n>` branch, summarize the issue as
  working context, then implement it following this repo's workflow (Biome, typecheck,
  Vitest, changesets, Prisma migrations, ADR/PRD updates). Use when the user says to
  work on, solve, fix, or pick up a specific issue number. Never commits, pushes, or
  opens a PR itself; it hands back a suggested commit message and PR title/body and
  leaves committing, pushing, and opening the PR to the user. For a fully automated
  version that also commits, pushes, opens the PR, and handles Copilot review, use
  auto-solve-issue instead.
---

# Solving a filed issue (manual)

Second half of this repo's investigate → solve workflow (see `investigate-issue` for
the first half). Expects an issue number as input (e.g. `/solve-issue 9`). If none was
given, ask.

## 1. Fetch the issue

```bash
gh issue view <n> --json number,title,body,labels,milestone,url
```

Read the body fully — it links the PRD requirement and ADRs, and lists acceptance
criteria. Read those linked docs too.

Stay in discussion mode instead of branching/coding when:

- the title starts with `[Scoping]`, or
- an acceptance criterion requires a decision that hasn't been made yet (e.g. "Field
  list reviewed and agreed in this issue before implementation" with no agreement in the
  issue comments: check `gh issue view <n> --comments`). Propose the decision, get the
  user's answer, and suggest recording it as an issue comment before coding.

Also check dependencies: if the body references other open issues it builds on (e.g.
"validated against the document schema (#9)"), say so and ask whether to proceed.

## 2. Sync and branch

- `git status` — if the working tree isn't clean, stop and ask before doing anything
  that could discard work.
- `git checkout dev && git pull`
- Branch type prefix (personal repo, so no GitHub issue types — derive it from labels
  and content): `bug` label → `fix`; spikes, CI, deployment or docs-only work → `chore`;
  everything else (new functionality) → `feat`.
- `git checkout -b <type>/issue-<n>`

## 3. Hand off with context, then implement

Summarize: the issue's goal, the acceptance criteria, the relevant PRD/ADR constraints
and the files likely involved. Then implement it following the project rules in
`AGENTS.md` (layout and dependency rules, architecture rules, database and environment,
conventions, gotchas). In particular: if the work changes or contradicts a decision or
requirement, update the PRD or write a new ADR (accepted ADRs are not edited).

Before calling it done, all of these must pass:

```bash
pnpm check:fix && pnpm check
pnpm typecheck
pnpm test
pnpm build
```

Add tests alongside the change (Vitest in `packages/*`). Add a changeset with
`pnpm changeset` (or write `.changeset/<name>.md` directly) for any behaviour change,
bumping the affected `@furrow/*` packages.

## 4. When the work is ready

Do not run `git commit`, `git push`, or `gh pr create` — the user commits and pushes
themselves. Stop once code, tests and changeset are ready, and hand back:

- Commit message(s) following this repo's convention: one short line, `type: description`
  (`feat:`, `fix:`, `chore:`, `ci:`, `docs:`, `test:`), split by concern — see recent
  `git log` for tone.
- A PR title/body suggestion: PR to `dev` (not `main`, which is the default branch), body
  following `.github/pull_request_template.md` with `Closes #<n>`.
