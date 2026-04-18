# SproutGit Design Review and Screen Plan

## What is good from current design exploration

1. Context cascade requirement is now explicit and repeatedly represented:
   - Repo > Worktree > Branch
2. Worktree-first navigation is present in later variants, with managed worktrees prioritized.
3. A dedicated Worktree Convention policy/settings concept exists.
4. A Global Context Switcher concept exists for keyboard-first users.
5. Visual style direction is distinct enough from generic web templates.

## What is terrible or off-target

1. Early dashboard designs look like web landing pages, not a desktop Git client.
2. Some layouts underuse data density and do not reflect power-user workflows.
3. Commit and file workflows are not consistently first-class in all variants.
4. Diff and graph surfaces are under-specified in current screens.
5. Action hierarchy is occasionally marketing-like (hero blocks) rather than operational.

## Design correction decisions

1. Treat the product as an IDE-like utility, not a website.
2. Use a dense four-pane layout as the base pattern.
3. Keep context cascade permanently visible in title/header.
4. Prioritize managed worktrees and make policy visible at creation time.
5. Minimize decorative surfaces and maximize operational clarity.

## Screen architecture for MVP

1. App Shell and Context Header
   - Persistent top strip with Active Repo, Active Worktree, Active Branch.
   - Context chips with active color and quick switch affordance.

2. Main Workspace Screen (daily driver)
   - Left rail: Repositories
   - Mid-left rail: Worktrees and branches (managed first)
   - Center pane: Status list (staged and unstaged)
   - Right pane: Diff inspector and commit composer

3. Worktree Creation Screen
   - Default managed path: <repo_root>/.worktrees/<slug>
   - Source branch, branch name, slug/path preview, validation, create actions

4. Global Context Switcher Modal
   - Keyboard-first searchable list
   - Sections: Repositories, Managed Worktrees, Branches
   - Quick commands: New Managed Worktree, New Branch+Worktree, Open External Worktree

5. Worktree Convention Settings Screen
   - Enforce managed path toggle (default on)
   - Rules, validation examples, migration helper for external worktrees

6. History and Graph Screen
   - Commit list with branch/tag badges
   - Graph lane column with branch topology
   - Commit details and file diff preview

7. Diff Focus Screen
   - Unified/split toggle
   - Syntax-highlighted hunks
   - Hunk collapse/expand and large-file fallback

## Library recommendations (do not reinvent)

1. Syntax highlighting
   - Primary: Shiki (fine-grained loading)
   - Fallback: highlight.js

2. Diff rendering
   - Primary: git-diff-view with Svelte bindings
   - Fallback: lightweight custom renderer using diff parser libraries

3. Commit graph and branch tree
   - Primary: structured Git log data rendered in SVG/canvas lanes
   - Practical fallback: ASCII graph column from Git with enhanced metadata chips

4. Large list virtualization
   - Primary: Svelte virtual list approach for file/status/history lists

5. Git source of truth
   - Primary: Git CLI porcelain and structured format output from Tauri commands

## Backend data contracts to standardize early

1. Context state
   - activeRepoPath
   - activeWorktreePath
   - activeBranchName
   - isDetachedHead

2. Worktree list
   - path
   - branch
   - head
   - managed boolean
   - status summary

3. Diff payload
   - file path and status
   - hunks with line numbers and line type
   - large/binary flags

4. Commit graph payload
   - commit id, parents, refs, author/date/message
   - precomputed render lanes per row

## Implementation order after design sign-off

1. Tailwind setup and desktop shell layout scaffolding
2. Context header + four-pane baseline
3. Worktree rails and managed/external labeling
4. Diff component integration
5. Commit graph/history integration
6. Polish and performance passes
