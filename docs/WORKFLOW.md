# Work coordination — Sylo dev repo

All work on this repo is coordinated through **GitHub Issues** and the **Sylo work
board** (user-level GitHub Project). The rule in one line: **no unclaimed, untracked
work — if it isn't an issue, it isn't being coordinated.**

This applies to every agent session and human, regardless of tool (Sylo chats, Cursor,
GitHub Desktop, CLI). `AGENTS.md` carries only the pointer; this file is the process.

## Where things live

| Surface | Purpose |
|---|---|
| Issues on **Yeti-Trix/pi-sylo-dev** (private) | In-flight/confidential work: unreleased features, bugs, refactors. Design docs live in the issue body. |
| Issues on **Yeti-Trix/pi-sylo** (public) | Shipped/community-facing items: public roadmap, user-facing bug reports. |
| **Sylo work board** (GitHub Project, user-level) | The kanban across both repos; cards auto-move on PR open/merge — never drag by hand. |

The folder trackers (`features_tracker/`, `issue_tracker/`) were retired 2026-09-11
(pi-sylo-dev #20). Old docs remain in git history:
`git log --oneline -- features_tracker` / `git show <rev>:<path>` to recover one.

## Before starting ANY feature, fix, or refactor

1. **Check what's in flight** for the area you're about to touch:
   - `gh issue list` on **both** repos — open issues and who's assigned
   - `gh pr list` — open PRs (work with an open PR belongs to its author)
   - If someone is already assigned, **do not start** — pick something else or
     coordinate with them first. This is what prevents two agent sessions editing
     the same files (this has happened: 2026-09-11, two sessions collided in
     `apps/host/src/main/database.ts`).
2. **Claim before you build** — self-assign the issue (`gh issue edit N --add-assignee @me`)
   or comment "taking this". If no issue exists, **open one first** describing what
   you're about to do, then claim it.
3. **Pull before starting** (`git pull --ff-only`) so you're not building on stale code.
4. **Reference the issue from your PR** — put `Fixes #N` in the PR body so the issue
   auto-closes on merge, and the board card slides to Done automatically.
5. **Keep PRs small.** Long-lived branches are the main source of merge collisions.
   Commit and merge often.

## Direct commits vs PRs

`Fixes #N` in a commit pushed **directly to the default branch** closes the issue but
**skips the board automation** — it keys off PR bodies, so the card never appears. If
you commit directly, add the card to the board yourself (or better: open the PR).
Statuses: `Todo` → `In Progress` (PR opened with `Fixes #N`) → `Done` (PR merged or
issue closed).

## Board automation — never move cards by hand

The board (GitHub Project "Sylo work board", user-level) keeps itself honest:

- PR opened with `Fixes #N` in the body → the linked issue is added to the board
  (if missing) and its card slides to **In Progress** (`.github/workflows/board-slide.yml`)
- PR merged → card slides to **Done**, issue auto-closes
- Issue closed directly → card slides to **Done**

Your only obligation: **reference the issue in the PR body (`Fixes #N`)** — the
automation keys off that text. Don't drag cards manually; if a card is wrong, fix
the issue/PR linkage, not the card.

## For Sylo agent sessions specifically

Sylo chats running in this workspace should check `gh issue list` before starting
batch work and record claims. One-off quick fixes (typos, build breaks) don't need
an issue — judgment applies; anything spanning multiple files or sessions does.