# SproutGit MVP Requirements

## Product Goal
Build a fast, open-source, cross-platform Git desktop app that treats worktrees as the default way to work.

## Core UX Principle
At all times, the app must make these three contexts obvious and ordered:

1. Active Repository
2. Active Worktree
3. Active Branch

This is a cascade where branch belongs to worktree, and worktree belongs to repository.

## Prescribed Worktree Approach
SproutGit enforces a standard layout for managed repositories:

- Repository root: <repo_root>
- Managed worktrees container: <repo_root>/.worktrees/
- Individual worktree path: <repo_root>/.worktrees/<branch_or_ticket_slug>

Rules:

1. New worktrees created by SproutGit must be placed under .worktrees.
2. SproutGit labels each worktree as:
   - Managed: path under <repo_root>/.worktrees/
   - External: path outside the managed container
3. Default action for branch creation is "Create branch + worktree".
4. Worktree switcher prioritizes managed worktrees first.
5. Deleting a managed worktree prunes both Git metadata and its folder.

## MVP Scope

1. Repository onboarding
   - Open existing repository
   - Clone repository
2. Worktree-first operations
   - List worktrees
   - Create worktree from branch
   - Switch active worktree
   - Prune worktree
3. Basic Git workflow
   - Status
   - Stage and unstage
   - Commit
4. Context clarity UI
   - Persistent context header: Repo > Worktree > Branch
   - Color-coded context chips
   - Global quick switcher

## Out of Scope (MVP)

1. Merge conflict editor
2. Rebase/cherry-pick visual workflows
3. AI commit naming (defer to v0.2 BYOK)

## Non-Functional Requirements

1. Fast startup and low memory footprint
2. Equal support priority: macOS, Windows, Linux
3. Clear, actionable error states for Git failures
4. No hidden state changes; all branch/worktree changes are explicit in UI

## Acceptance Criteria (Design Phase)

1. Primary screen includes a persistent, unambiguous Repo > Worktree > Branch cascade.
2. Worktree creation flow defaults to managed path under .worktrees.
3. Worktree list visually distinguishes Managed vs External.
4. Navigation makes worktrees first-class, not buried under advanced menus.
