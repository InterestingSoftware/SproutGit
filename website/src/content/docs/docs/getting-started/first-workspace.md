---
title: Your first workspace
description: Open, clone, or import a project as a SproutGit workspace, and create your first worktree.
---

In SproutGit, a **workspace** is a project you've opened — it wraps one Git
repository plus the [worktrees](/docs/concepts/worktree-workflow/) you create
inside it. The home screen's **Start** panel gives you four ways to get one:

## New from idea

Only shown once you've configured an [AI coding agent](/docs/guides/coding-agents/)
in Settings. Describe an app idea in a couple of sentences and the agent
drafts a name, tech stack, and description for you to confirm; SproutGit then
creates a fresh workspace and kicks off the agent with a prompt to scaffold
the project (initial folder structure, README, `.gitignore`, baseline config)
and make the first commit.

## Clone

Clone an existing Git repository (from GitHub or any URL) into a new
workspace folder under your configured projects folder. If you've connected
your GitHub account (**Settings → GitHub**), the clone dialog autocompletes
against your repos.

## Open Folder

Open a native folder picker and select any local Git repository. This is the
right choice for a repo you already have checked out that you just want to
start managing with SproutGit.

## Import Git Repo

Turn an existing local repo into a proper SproutGit workspace. You choose
how:

- **Import in place** — restructures the folder in-situ; the repo becomes
  the workspace root at the same location.
- **Move to new workspace** — moves the repo into a new workspace folder,
  removing the original location.
- **Copy to new workspace** — copies the repo into a new workspace folder
  and leaves the original untouched.

Under the hood, importing converts your repo's `.git` directory into a bare
repository and recreates whatever branch was checked out as your first
managed worktree — see [Workspace layout on disk](/docs/concepts/workspace-layout/)
for what that looks like. Import refuses to run against a dirty working tree
or a detached `HEAD`; commit or stash your changes (and check out a branch)
first.

## Recent projects

Every workspace you've opened shows up in the **Recent projects** list on
the home screen, so day-to-day you'll mostly be reopening from there rather
than repeating Clone/Open/Import.

## Creating your first worktree

Once a workspace is open, the sidebar shows its worktrees. Click **Create
worktree**, name a new branch (or pick an existing one), and choose the ref
to branch from — SproutGit creates the worktree under
`.sproutgit/worktrees/` and switches to it. From there you get a Commit
graph, a Changes/diff view, and an integrated terminal scoped to that
worktree, all without disturbing any other worktree you have open.

If the workspace or its repo ships hooks (a `sproutgit.hooks.json` file, or
local hooks you've defined), they can run automatically before/after you
create, switch, or remove a worktree — see
[Hooks & the trust model](/docs/concepts/hooks-and-trust/).
