# SproutGit MVP Requirements

## Product Goal

Build a fast, open-source, cross-platform Git desktop app that treats worktrees as the default way to work.

## Core UX Principle

At all times, the app must make these three contexts obvious and ordered:

1. Active Repository
2. Active Worktree
3. Active Branch

This is a cascade where branch belongs to worktree, and worktree belongs to repository.

## SproutGit Workspace Layout (Prescribed)

SproutGit enforces a project workspace structure above Git root/worktrees:

- Project workspace root: <project_workspace>
- Main checkout (Git primary worktree, protected internal checkout): <project_workspace>/root/
- Managed worktrees container: <project_workspace>/worktrees/
- Individual managed worktree path: <project_workspace>/worktrees/<branch_slug>
- SproutGit project metadata: <project_workspace>/.sproutgit/
  - SQLite database: <project_workspace>/.sproutgit/state.db
  - Project marker/metadata file: <project_workspace>/.sproutgit/project.json

App-level config storage (global, per user):

- SQLite config database in user profile directory (cross-platform app config location)
- Stores recent workspaces and app settings

Rules:

1. New managed worktrees must be created under <project_workspace>/worktrees/.
2. The primary Git checkout must live at <project_workspace>/root/.
3. The primary checkout at <project_workspace>/root/ is a protected internal checkout and should not be the default location for day-to-day feature work.
4. Long-lived branches such as `main`, `master`, `develop`, and `release/*` should use dedicated worktrees for normal editing when the product exposes that workflow.
5. SproutGit labels each worktree as:
   - Managed: path under <project_workspace>/worktrees/
   - External: path outside the managed container
6. Default action for branch creation is "Create branch + worktree".
7. Worktree switcher prioritizes managed worktrees first.
8. Deleting a managed worktree prunes both Git metadata and its folder.
9. Presence of <project_workspace>/.sproutgit/project.json identifies the filesystem as a SproutGit project.
10. SQLite state.db stores workspace-local state, not Git object data.
11. Global app settings and recent-workspace state must be stored in the user-profile config SQLite database.

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

## Solid MVP Feature List (v0.1)

### P0: Must ship

1. Repository workspace bootstrap
   - Open local repository
   - Clone repository into a managed workspace
   - Show recent repositories
2. Persistent context clarity
   - Always-visible Repo > Worktree > Branch cascade
   - Explicit active indicators and detached HEAD state
3. Worktree-first core flow
   - List worktrees with Managed vs External labels
   - Create managed worktree from branch
   - Switch active worktree quickly
   - Prune/remove worktree safely
   - Keep the protected `root/` checkout distinct from normal day-to-day worktrees
4. Branch plus worktree workflow
   - Default action: create branch + create managed worktree
   - Branch list and create from selected base
5. Status and commit workflow
   - Working tree status grouped as staged and unstaged
   - Stage and unstage file-level changes
   - Commit from current worktree
6. Commit history and graph (essential)
   - Commit log with branch/tag decorations
   - Graph lane view showing branch topology
   - Selection sync between log row and graph row
7. Guardrails and errors
   - Clear errors for invalid repo/worktree operations
   - Confirm destructive worktree removal actions

### P1: Should ship if stable

1. Fetch and pull for current worktree
2. Push current branch with upstream setup
3. Keyboard-first global context switcher
4. Repo-scoped worktree lifecycle hooks (local-only, persisted in workspace SQLite)

### P2: Candidate (post-MVP)

1. Hook execution history UI (per-hook run logs and status)
2. Hook parallel execution groups with timeout and blocking policy controls
3. Shell-aware script editor highlighting (bash/zsh/pwsh) in workspace settings

### Excluded from v0.1

1. Merge conflict editor
2. Rebase/cherry-pick UI
3. Stash UI
4. AI commit naming
5. External issue tracker integrations

## MVP Done Criteria

1. A user can complete the standard feature-branch flow without terminal fallback:
   - Open repo -> create branch+worktree -> make and stage changes -> commit -> push
2. The UI always shows unambiguous current Repo > Worktree > Branch context.
3. Managed workspace convention (<project_workspace>/root + /worktrees) is enforced by default and visible in creation flows.
4. Core workflows pass smoke tests on macOS, Windows, and Linux.
5. Commit history graph is available in MVP and reflects branch topology for recent history.

## Out of Scope (MVP)

1. Merge conflict editor
2. Rebase/cherry-pick visual workflows
3. AI commit naming (defer to v0.2 BYOK)
4. External issue tracker integrations for naming automation (defer to post-MVP)

## Post-MVP Integrations (Planned)

1. Issue tracker driven worktree and branch naming templates
   - Linear
   - Azure DevOps Work Items
   - GitHub Issues
   - GitLab Issues
   - Jira
2. Optional branch/worktree name suggestions from selected issue context.
3. Smart defaults such as <issue_key>-<slug> and branch/worktree pair creation.
4. Integration model should be provider-agnostic and pluggable so each provider can be added incrementally.

## Post-MVP Agent Control (Planned)

1. MCP control surface for agent orchestration across SproutGit projects.
2. Agent-safe operations only (create/switch/prune worktree, branch creation, status reads, commit drafting).
3. Explicit permission and confirmation gates for destructive operations.
4. Project-scoped capability model backed by .sproutgit metadata and SQLite state.
5. Full audit trail in project state for agent-triggered actions.

## Post-MVP Local Automation (Planned)

1. Repository-scoped lifecycle hooks for worktree create/remove events.
2. Hooks stored in `<project_workspace>/.sproutgit/state.db`, never committed to Git by default.
3. Hook scripts run with OS-specific shells:
   - Linux: bash
   - macOS: zsh
   - Windows: PowerShell Core (`pwsh`)
4. Hook definitions and runs managed with an ORM-backed SQLite model.
5. Hook dependency model supports multiple dependencies (AND semantics) and tree/DAG execution.
6. Hooks can be marked critical (required) or non-critical.
7. Force remove bypasses only failing non-critical hooks; critical failures still block.
8. `after_*` hook failures are warning-only by default.
9. Hook editor uses Monaco with shell-aware syntax highlighting.

## Non-Functional Requirements

1. Fast startup and low memory footprint
2. Equal support priority: macOS, Windows, Linux
3. Clear, actionable error states for Git failures
4. No hidden state changes; all branch/worktree changes are explicit in UI
5. SQLite project state must be resilient to app restarts and safe to rebuild from Git + filesystem state

## Acceptance Criteria (Design Phase)

1. Primary screen includes a persistent, unambiguous Repo > Worktree > Branch cascade.
2. Worktree creation flow defaults to managed path under <project_workspace>/worktrees/.
3. Worktree list visually distinguishes Managed vs External.
4. Navigation makes worktrees first-class, not buried under advanced menus.
