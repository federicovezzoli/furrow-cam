---
name: solve-all-issues
description: >
  Bulk-run auto-solve-issue over a batch of open GitHub issues in furrow-cam: by default
  every issue assigned to the current user, or, with `--milestone <slug>` (e.g.
  `/solve-all-issues --milestone stl-import`), every open issue in that milestone. Opens
  one PR per issue (against `dev`) with review requested and addressed on each. Skips
  `[Scoping]` issues, issues with undecided acceptance criteria and issues blocked by
  other open issues. Use when the user wants to clear their assigned-issue queue or a
  whole milestone in one go rather than naming issues one at a time.
argument-hint: "[--milestone <slug|number>] [--mine]"
---

# Bulk-solving a batch of issues

Composes `auto-solve-issue` over a filtered issue list. Read that skill first — this one
adds the listing, filtering, ordering and looping around it.

## 0. Pick the batch

Arguments: `$ARGUMENTS`

- **No flags**: the batch is every open issue assigned to the current user.
- **`--milestone <value>`**: the batch is every open issue in that milestone. The value
  is the milestone's slug (its title lowercased, with runs of non-alphanumeric
  characters turned into `-`: `STL import` → `stl-import`, `Post-MVP` → `post-mvp`),
  its number, or its exact title in quotes.
- **`--mine`** (with `--milestone`): restrict the milestone batch to issues assigned to
  the current user.

If the user asks in plain words instead ("solve the STL import milestone"), treat it as
the equivalent flags.

Resolve the milestone before listing:

```bash
gh api 'repos/{owner}/{repo}/milestones?state=all' --jq '.[] | "\(.state)\t\(.number)\t\(.title)\t\(.title | ascii_downcase | gsub("[^a-z0-9]+"; "-") | ltrimstr("-") | rtrimstr("-"))"'
```

Columns: state, number, title, slug. Match the value against the slug, the number or the
title (case-insensitively). If nothing matches, or more than one does, say so, list the
open milestones with their slugs and stop; don't guess. If the milestone is closed, say
so and stop.

## 1. List the open issues

```bash
# default: assigned to me
gh issue list --assignee "@me" --state open --limit 200 --json number,title,body,labels,milestone,assignees,url

# milestone (pass the exact milestone title resolved above)
gh issue list --milestone "<title>" --state open --limit 200 --json number,title,body,labels,milestone,assignees,url
# --milestone with --mine: add --assignee "@me"
```

In milestone mode, issues assigned to **someone else** are skipped (someone owns them);
unassigned issues are in scope — assign each one to yourself
(`gh issue edit <n> --add-assignee @me`) when you start it, so the milestone shows who
is working on what.

If the list is empty, say so and stop. With no argument, suggest assigning issues
(`gh issue edit <n> --add-assignee @me`) or passing `--milestone <slug>`, rather than picking
issues on your own.

## 2. Filter and order

Skip, and say why:

- titles starting with `[Scoping]` (case-insensitive), or bodies that read as an open
  design question;
- issues assigned to someone other than the current user (milestone mode only);
- issues that still need a decision (a "proposed" list or an open question in the body;
  agreed scope is always recorded in the issue body, not in comments).

Order the rest so that dependencies come first: if an issue builds on another listed
issue (e.g. #12 references the document schema in #9), process the dependency first.
If it depends on an open issue that is **not** in the list, skip it as blocked.

Show the user the resulting plan before starting — which issues will be auto-solved and
in what order, which were skipped and why — as a plain status line, not a blocking
question. The user already authorized the automated flow; this just makes the batch's
scope visible before multiple PRs are opened.

## 3. Process sequentially

Run `auto-solve-issue` for each issue, one at a time. Sequentially, not in parallel —
they share the same working tree. Between issues, run `git checkout dev && git pull`
before starting the next one.

Because PRs are not merged automatically, an issue that depends on one processed
earlier in the same batch can't build on unmerged code from `dev`. Either branch it off
the dependency's PR branch and say so in its PR body ("Based on #<pr>, merge that
first"), or skip it as blocked — prefer skipping unless the user asked otherwise.

If one issue fails or gets stuck (CI red, review never arrives, a comment needs a human
decision), report its status and move on rather than aborting the batch.

## 4. Final summary

A table: issue number → PR URL → status (ready for review / blocked on X / skipped as
scoping or blocked), once every issue in the list has been attempted. In milestone mode, end with how many
issues remain open in the milestone and why (skipped, blocked, awaiting merge).
