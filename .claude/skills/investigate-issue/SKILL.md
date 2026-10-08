---
name: investigate-issue
description: >
  Investigate a suspected bug, gap or new piece of work in furrow-cam and file a GitHub
  issue for it in this repo's issue format (context, acceptance criteria, links to
  PRD/ADR and to exact lines on `dev`, `area:*` label, MVP milestone when it belongs
  there). Use when the user reports something broken, asks to "look into" or
  "investigate" a problem, or wants a finding or idea turned into a tracked issue.
  Investigation and filing only — it does not change code; use solve-issue (manual) or
  auto-solve-issue (automated, opens a PR) to work on an already-filed issue.
---

# Investigating and filing an issue

This repo's workflow is: investigate first, file a GitHub issue, then a separate pass
(`solve-issue` or `auto-solve-issue`) branches off `dev` and implements it. Stay in
investigate-only mode here — don't edit code, don't open a PR.

## 1. Investigate

- Trace the actual root cause by reading the code, not by guessing from the symptom.
  Note exact file paths and line ranges as you go.
- Identify the affected part of the monorepo (see ADR-0011):
  - `apps/web` — Next.js UI, viewport, server actions, Prisma, auth
  - `packages/document` — project document schema and migrations
  - `packages/cam-core` — geometry and toolpaths (framework-agnostic)
  - `packages/post` — post-processors / G-code
- Check whether a PRD requirement (`docs/prd/`) or an ADR (`docs/adr/`) already covers
  it, and whether the finding contradicts an accepted ADR.
- If you're not confident you've found the real cause, say so in the issue rather than
  presenting a guess as settled fact.

## 2. Draft the issue, matching existing conventions

Skim a couple of existing issues for tone and format before drafting:
`gh issue list --limit 10 --state all`, then `gh issue view <n>` on one or two.

**Title:** concise and specific, e.g. `Pocket leaves uncut islands when step-over > 50%`.
Prefix with `[Scoping]` only for an open design question that needs discussion before
any code is written (`auto-solve-issue` refuses these).

**Body**, in English (the repo is public), using only the sections that apply:

- A short opening paragraph — what's wrong or what's needed, and why. Reference the PRD
  requirement (e.g. `PRD-0001 **R7**`) and ADRs, linked with full GitHub URLs.
- Code links as permalinks: `https://github.com/<owner>/<repo>/blob/dev/<path>#L<start>-L<end>`
  (get owner/repo from `gh repo view --json nameWithOwner`), plus the relevant snippet in
  a fenced code block.
- `### Impact` — for bugs: the concrete, triggerable consequence.
- `### Proposed fields` / `### Suggested fix` — a concrete direction, if you have one.
- `### Acceptance criteria` — a checklist (`- [ ] ...`) that defines done.
- `### Notes` — related issues (`#n`), how it was found.

**Labels:** exactly one `area:*` label (`area:data`, `area:ui`, `area:cam`, `area:infra`),
plus `bug` for defects. **Milestone:** `MVP` if it's needed for PRD-0001, otherwise none.

## 3. Confirm, then file

Show the user the drafted title, body, labels and milestone before creating anything —
filing an issue on a public repo is a visible, shared action and needs explicit
confirmation first.

Once confirmed:

```bash
gh issue create --title "..." --label "area:..." [--label bug] [--milestone MVP] --body "$(cat <<'EOF'
...
EOF
)"
```

Report back the issue number/URL that `gh issue create` returns.
