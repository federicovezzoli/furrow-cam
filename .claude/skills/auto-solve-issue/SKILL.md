---
name: auto-solve-issue
description: >
  Fully automated version of solve-issue: pick up an already-filed, already-scoped
  GitHub issue in furrow-cam, implement it, commit, push, open a PR to `dev`, request a
  GitHub Copilot code review (when available), wait for it, and address (or reply to)
  its comments before handing back a final status. Use when the user explicitly asks to
  "auto-solve" an issue or otherwise wants the whole issue-to-PR loop handled without
  stopping for commit/push/PR confirmation. Refuses `[Scoping]` issues and issues with
  undecided acceptance criteria. Never merges the PR — merging stays a human action.

  This is a deliberate, explicit exception to the normal workflow (see solve-issue),
  where the user commits and pushes. That exception is scoped to this skill only — don't
  generalize "auto-solve-issue commits and pushes" into "it's fine to commit/push on my
  own initiative elsewhere".
---

# Auto-solving a filed issue end-to-end

Expects an issue number as input (e.g. `/auto-solve-issue 9`). If none was given, ask.

This skill commits, pushes, and opens a PR **without stopping for confirmation** —
that's the point of it, and it's an explicit exception the user granted for this skill
specifically. Everything else still follows the normal risk-confirmation rules: if the
work requires a genuine product or design decision (not just a mechanical
implementation), stop and ask rather than guessing.

## 0. Refuse unscoped issues

```bash
gh issue view <n> --json number,title,body,labels,milestone,url
gh issue view <n> --comments
```

**Stop here** and report back, without branching, if:

- the title starts with `[Scoping]`, or the body reads as an open design question;
- an acceptance criterion requires a decision not yet recorded in the issue or its
  comments (e.g. "Field list reviewed and agreed in this issue before implementation");
- the issue builds on another issue that is still open (e.g. "validated against the
  document schema (#9)" while #9 is open) — report the blocking issue.

## 1. Sync, branch, implement

Same as `solve-issue` steps 2-3: `git status` (stop and ask if the tree isn't clean —
don't discard someone's in-progress work), `git checkout dev && git pull`, branch as
`<type>/issue-<n>` (`bug` label → `fix`; spikes/CI/deployment/docs → `chore`; otherwise
`feat`), then implement following the project rules in `AGENTS.md`.

Add tests and a changeset. Run before moving on:

```bash
pnpm check:fix && pnpm check
pnpm typecheck
pnpm test
pnpm build
```

Fix anything these surface. Don't proceed to commit with anything red.

## 2. Commit, push, open the PR

- Commit with this repo's convention: one short line, `type: description`, split by
  concern (e.g. code / docs) — match recent `git log`.
- `git push -u origin <type>/issue-<n>`
- Open the PR **against `dev`** (`main` is the default branch, so `--base dev` is
  required), following `.github/pull_request_template.md`:

```bash
gh pr create --base dev --title "<type>: <description>" --body "$(cat <<'EOF'
Closes #<n>

## What

...

## Checklist

- [x] Changeset added
- [x] ADR or PRD updated (or: not needed)
- [x] Tested locally (`pnpm check && pnpm typecheck && pnpm test && pnpm build`)
EOF
)"
```

Capture the PR number (`gh pr view --json number -q .number`). Then check CI:
`gh pr checks <pr> --watch` (run in the background); if CI fails, fix and push before
requesting review.

## 3. Request a Copilot review

```bash
gh pr edit <pr> --add-reviewer @copilot
```

If that handle is rejected, fall back to:

```bash
gh api repos/<owner>/<repo>/pulls/<pr>/requested_reviewers \
  -f 'reviewers[]=copilot-pull-request-reviewer[bot]'
```

Copilot code review requires a Copilot plan on the account. If both requests fail
because it isn't available, skip steps 4-5, say so in the final report, and do a
careful self-review of the diff instead (`gh pr diff <pr>`).

## 4. Poll for the review

Copilot's review takes a few minutes. Poll in the background instead of blocking on a
foreground sleep loop. Note the review IDs already present *before* each request so the
loop waits for a genuinely new one:

```bash
before="$(gh pr view <pr> --json reviews --jq \
  '.reviews[] | select(.author.login | test("copilot"; "i")) | .id')"
# ...request/re-request the review here...
until gh pr view <pr> --json reviews --jq \
  '.reviews[] | select(.author.login | test("copilot"; "i")) | .id' \
  | grep -vxF "$before" | grep -q .; do
  sleep 30
done
```

Run this via the Bash tool with `run_in_background: true` and a timeout around 15
minutes. If it times out without a new review, say so plainly and stop — report the PR
as open and awaiting review.

## 5. Read and address Copilot's comments

```bash
gh pr view <pr> --json reviews,comments
gh api repos/<owner>/<repo>/pulls/<pr>/comments   # inline comments, with file/line/body
```

For each comment:

- If it points at a real issue, fix it, with the same check/test discipline as step 1.
- If it's a false positive or out of scope, reply on the thread briefly explaining why
  (`gh api repos/<owner>/<repo>/pulls/<pr>/comments/<id>/replies -f body="..."`).

If you made changes, commit and push to the same branch (no new PR). Copilot does not
re-review automatically on a push — re-request it with the same call as step 3, then
repeat step 4. Cap it at two review rounds total; after that, hand it to the user.

## 6. Final report

Never run `gh pr merge` — merging is a human decision. Report:

- Issue number and PR URL.
- What was implemented (brief), including any migration, changeset and doc updates.
- CI status.
- What Copilot flagged and, for each item, fixed or why not (or that review was
  unavailable).
- Current status: ready for human review/merge, or blocked on something specific.
