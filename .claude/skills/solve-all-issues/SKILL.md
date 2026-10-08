---
name: solve-all-issues
description: >
  Bulk-run auto-solve-issue over every open GitHub issue assigned to the current user in
  furrow-cam, opening one PR per issue (against `dev`) with review requested and
  addressed on each. Skips `[Scoping]` issues, issues with undecided acceptance criteria
  and issues blocked by other open issues. Use when the user wants to clear their whole
  assigned-issue queue in one go rather than naming issues one at a time.
---

# Bulk-solving all assigned issues

Composes `auto-solve-issue` over a filtered issue list. Read that skill first — this one
adds the listing, filtering, ordering and looping around it.

## 1. List assigned open issues

```bash
gh issue list --assignee "@me" --state open --json number,title,labels,milestone,url
```

If nothing is assigned, say so and stop; suggest assigning issues
(`gh issue edit <n> --add-assignee @me`) rather than picking issues on your own.

## 2. Filter and order

Skip, and say why:

- titles starting with `[Scoping]` (case-insensitive), or bodies that read as an open
  design question;
- issues whose acceptance criteria require a decision not yet recorded in the issue
  comments (e.g. an agreed field list).

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
scoping or blocked), once every issue in the list has been attempted.
