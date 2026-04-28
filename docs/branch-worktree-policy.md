# Branch/Worktree Binding Policy

This document defines how SproutGit should bind branches to worktrees so local workflows remain predictable while still supporting advanced remote workflows.

This policy is subordinate to [requirements.md](requirements.md). If terminology or scope differs, `requirements.md` is the source of truth for MVP behavior.

## Goals

- Keep a clear, repeatable default workflow for most users.
- Reduce accidental branch/worktree drift.
- Support real-world merge strategies (merge commit, squash, rebase).
- Avoid destructive cleanup when local work may still exist.

## Core Model

SproutGit uses two branch classes:

1. Managed (ephemeral)
2. Persistent (trunk/release)

These branch classes are separate from the worktree labels defined in [requirements.md](requirements.md):

- `Managed` worktree: path under `<project_workspace>/worktrees/`
- `External` worktree: path outside the managed container

In other words, worktree classification is filesystem-based, while branch classification is lifecycle-based.

### Managed Branches (Ephemeral)

- Always bind 1:1 to a single managed worktree.
- Worktree checkout is locked to the bound branch.
- Intended for feature, bugfix, spike, and short-lived task branches.
- Eligible for merge-based cleanup suggestions.

### Persistent Branches (Trunk/Release)

- Represent long-lived branches such as `main`, `master`, `develop`, `release/*`.
- Should use dedicated worktrees for normal editing.
- The primary checkout at `<project_workspace>/root/` is the protected internal checkout, not the default day-to-day persistent-branch workspace.
- Dedicated persistent-branch worktrees should normally live under `<project_workspace>/worktrees/`.
- Deleting the worktree must never imply deleting the local branch.
- Not eligible for automatic branch-deletion suggestions.

## Branch Binding Rules

1. Each managed worktree stores:
   - `boundBranch`
   - `branchType` (`managed` or `persistent`)
   - `trackedRemote` (for example `origin`)
   - `targetBaseBranch` (for example `main`)
2. Managed worktrees cannot switch checkout to a different branch in-place.
3. If a user wants another branch from a managed worktree, offer:
   - Create a new managed worktree for that branch, or
   - Convert current worktree to unbound/expert mode (optional advanced feature).

## Merge And Integration Workflow

For the product direction, SproutGit should eventually provide merge/rebase/cherry-pick as guided operations rather than requiring branch switching inside the same worktree.

However, this is post-MVP guidance. [requirements.md](requirements.md) explicitly excludes merge conflict editor and rebase/cherry-pick UI from `v0.1`.

Recommended flow:

1. Select source branch/worktree and target branch/worktree.
2. Fetch and prune remote refs before evaluation.
3. Validate target worktree is clean (or require explicit force path).
4. Run integration operation.
5. Resolve conflicts in target worktree.
6. Mark source managed branch as `cleanup_candidate` when safe.

## Cleanup Detection Policy

Cleanup must be suggestion-first (not immediate deletion).

A managed branch/worktree is a cleanup candidate only when all checks pass:

1. Fresh remote state available (`fetch --prune` completed successfully).
2. Branch is integrated relative to configured base branch.
3. No unique local commits remain on the managed branch tip.
4. Worktree is clean, or user explicitly confirms force cleanup.
5. Branch type is `managed`.

### Integrated Detection Notes

Do not rely solely on "remote branch deleted" as the merge signal.

- Squash/rebase merges can remove direct ancestry while still integrating content.
- Some teams keep remote branches after merge.
- Some teams delete remote branches immediately.

Use multiple signals:

1. Graph ancestry where applicable.
2. Ahead/behind against target base.
3. Remote branch existence status.
4. Optional patch-equivalence heuristics for squash/rebase-heavy teams.

## Deletion Semantics

Per [requirements.md](requirements.md), deleting a managed worktree prunes the Git worktree metadata and removes its directory.

Branch deletion is a separate policy decision layered on top of worktree removal.

When user confirms cleanup of a managed branch, present explicit toggles:

- Delete worktree
- Delete local branch
- Delete remote branch (off by default)

Safety constraints:

- If unique local commits exist, default to keep local branch.
- If worktree has uncommitted changes, block cleanup or require explicit force.
- Never auto-delete persistent branches.

## Existing Branches Like `main`

Users should be able to commit directly to persistent branches using dedicated persistent worktrees.

Recommended default behavior:

1. Keep `<project_workspace>/root/` as the protected internal checkout.
2. Create or reuse a dedicated `main` worktree for normal editing.
3. Allow normal commit/pull/push operations there.
4. If that worktree is managed, deleting it still removes the Git worktree metadata and directory, but not the local branch ref.

## Remote Source Of Truth

Remote refs are source of truth for synchronization status, but local lifecycle is policy-driven:

- Remote state influences cleanup eligibility.
- Remote state does not unilaterally force local deletion.
- Local branch deletion always requires explicit user confirmation (except future policy opt-ins).

## Default Product Policy (Recommended)

1. Enforce 1:1 binding for managed branches.
2. Lock branch switching in managed worktrees.
3. Treat guided merge/rebase/cherry-pick operations as post-MVP workflow enhancements.
4. Suggest cleanup only after integration checks pass.
5. Never auto-delete persistent branches.
6. Keep advanced flexibility behind explicit workspace settings.

## Optional Advanced Settings

- Enable unbound/expert worktree mode.
- Auto-suggest remote branch deletion after local cleanup.
- Team-specific persistent branch patterns.
- Strict cleanup mode (for highly standardized teams).

## Why This Balance Works

- Predictable for day-to-day local development.
- Scales for multi-agent and multi-worktree usage.
- Compatible with varied remote team workflows.
- Safe by default while still allowing advanced flexibility.
