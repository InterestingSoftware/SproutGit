---
title: Workspace layout on disk
description: What SproutGit creates inside a workspace folder, and what's safe to touch by hand.
---

Opening, cloning, or importing a project creates a **workspace** — a folder
on disk with a `.sproutgit/` directory alongside your project files:

```
<workspacePath>/
  .sproutgit/
    root/               ← bare git repository (git init --bare)
    worktrees/          ← managed worktrees (one subdirectory per worktree)
    state.db            ← workspace SQLite database
    local-hooks.json    ← local hook definitions (machine-local, not tracked by git)
```

## `root/` — the bare repository

The repository itself always lives as a **bare** repo at
`.sproutgit/root/` — there's no working copy checked out directly there.
This is what makes multiple simultaneous worktrees possible: a bare repo has
no working directory of its own to conflict with any of them.

If you [import](/docs/getting-started/first-workspace/#import-git-repo) an
existing non-bare repo, SproutGit converts its `.git` directory into this
bare layout and recreates whatever branch was checked out as your first
worktree — your repo's history and remotes carry over untouched.

## `worktrees/` — your managed worktrees

Each worktree you create through the app gets its own subdirectory here,
e.g. `.sproutgit/worktrees/feature-login/`. This is a normal Git working
directory — you can build, run, and edit inside it exactly like any other
checkout; it just happens to share history with every other worktree under
the same `root/`.

Worktrees that weren't created by SproutGit (registered elsewhere via
`git worktree add`) are adopted and shown alongside these, but may live
outside this folder — see
[Managed vs. externally-managed worktrees](/docs/concepts/worktree-workflow/#managed-vs-externally-managed-worktrees).

## `state.db` — workspace database

A SQLite database, private to this workspace and this machine — it's never
committed to git. It holds worktree metadata, the hook run audit log, and
per-workspace UI state.

## `local-hooks.json` — your local hooks

Lifecycle hooks you define yourself through the app's Workspace Hooks UI,
private to this machine. See
[Hooks & the trust model](/docs/concepts/hooks-and-trust/) for how this
differs from hooks a repo ships to everyone via git.

## What lives where a worktree can see it

Inside each worktree's own working copy — tracked by git, alongside your
project's source — an optional `sproutgit.hooks.json` file lets a repo ship
lifecycle hooks that travel with `git clone`/`pull`, instead of staying
local to one person's machine. That file is part of your project, not part
of `.sproutgit/`.

## Should you touch any of this by hand?

- **`root/`, `worktrees/`, `state.db`** — no. These are managed by the app;
  editing or moving them can desync SproutGit's view of your repository.
- **`local-hooks.json`** — the app manages this too, but it's plain JSON if
  you ever need to inspect or back it up.
- **`sproutgit.hooks.json`** (inside a worktree, not `.sproutgit/`) — yes,
  this one's meant to be hand-edited and committed; see
  [Writing hooks](/docs/guides/writing-hooks/).
