## PR Title
Add workspace hook orchestration and per-hook operation tracking UI

## Summary
This PR introduces a complete workspace hook system for managed worktree operations, including backend execution orchestration, persisted hook state, and a richer frontend workflow for authoring and monitoring hooks.

The operation lock modal now tracks each hook independently, including pending hooks, parallel execution, status transitions, and per-hook logs.

## What Changed

### 1. Backend: Workspace Hook Platform
- Added workspace-scoped hook definitions persisted in the workspace SQLite state.
- Added dependency-aware execution ordering.
- Added support for parallel groups so eligible hooks can run concurrently.
- Added critical vs non-critical behavior to control blocking semantics.
- Added timeout handling and structured run logging.
- Added hook progress event emission for live UI updates.

### 2. Backend: Worktree Operation Integration
- Hook execution wired into lifecycle phases for:
  - before and after worktree create
  - before and after worktree remove
  - before and after worktree switch
- Critical hook failures can block operation completion.

### 3. Frontend: Hook Authoring and Management
- Added a dedicated workspace hooks modal flow.
- Added Monaco-backed script editing support.
- Improved UX for hook configuration, trigger selection, and dependency management.

### 4. Frontend: Operation Modal Observability
- Reworked modal to track hooks per hook ID, not as a single output stream.
- Added per-hook statuses:
  - Pending
  - Running
  - Complete
  - Skipped
  - Timed out
  - Error
- Added per-hook logs with stdout, stderr, and error output.
- Kept failure context visible until explicit dismiss, so errors are not lost.

### 5. Workspace and State Robustness
- Added and refactored DB/config modules to support hook persistence and runtime state.
- Included related workspace state handling updates for open/import behavior.

### 6. Documentation
- Added dedicated hook documentation.
- Updated architecture, requirements, design, and README docs.
- Added clear explanation of native Git capabilities versus SproutGit orchestration behavior.

## Why
Git provides worktrees and standard repository hooks, but does not natively provide:
- workspace-level hook registry and lifecycle policy
- dependency graph + parallel group orchestration
- per-hook critical policy and timeout governance
- desktop UI for live per-hook status and logs during managed operations

This PR adds that orchestration layer on top of Git primitives to make automation predictable, cross-platform, and observable.

## Validation
- Frontend checks pass.
- Existing pre-existing a11y warnings remain in the commit graph component and are unchanged by this PR.

## Reviewer Focus Areas
- Hook scheduling logic (dependencies + parallel group behavior)
- Failure semantics for critical vs non-critical hooks
- Progress event payload consistency and UI state transitions
- Operation modal behavior under concurrent hook execution and failures
- Documentation alignment with implemented behavior
