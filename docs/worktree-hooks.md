# Worktree Lifecycle Hooks (Proposed)

Date: 2026-04-20
Status: Proposed
Owner: SproutGit core

## Goal

Allow each SproutGit project to define local automation hooks that run on worktree lifecycle events.

Examples:

- Create config files
- Install dependencies
- Start/stop Docker services
- Run database migrations
- Create/remove local web server config (IIS/Apache/Nginx)

These hooks are user-local and must not be version-controlled.

## Scope

### In Scope

- Persist hook definitions in workspace SQLite (`<workspace>/.sproutgit/state.db`)
- Bind hooks to a repository workspace (shared across all worktrees in that workspace)
- Support lifecycle triggers for worktree create/remove
- Allow parallel execution for independent hooks
- Provide per-OS script language selection:
  - Linux: `bash`
  - macOS: `zsh`
  - Windows: `pwsh` (PowerShell Core)
- Provide syntax-highlighted hook editor in-app

### Out of Scope (Initial)

- Version-controlling hook definitions
- Global hooks across multiple repositories
- Distributed execution / remote runners
- Privileged escalation workflows

## Trigger Model

Initial trigger set:

- `before_worktree_create`
- `after_worktree_create`
- `before_worktree_remove`
- `after_worktree_remove`
- `before_worktree_switch`
- `after_worktree_switch`
- `manual`

Execution semantics:

- `before_*` hooks can block the operation on failure (policy-controlled)
- `after_*` hooks run after Git operation completes
- `after_*` failures do not roll back Git operations, but are surfaced clearly
- `manual` hooks run only when explicitly invoked from a worktree row

## SQLite Strategy (Decided)

Use two SQLite databases, both managed through ORM repositories and migrations:

1. User-profile config DB (global app state)

- Stores app-level settings like recent workspaces
- Suggested location:
  - macOS: `~/Library/Application Support/SproutGit/config.db`
  - Linux: `$XDG_CONFIG_HOME/SproutGit/config.db` (fallback `~/.config/SproutGit/config.db`)
  - Windows: `%APPDATA%/SproutGit/config.db`

2. Workspace DB (repo-scoped state)

- Existing location: `<workspace>/.sproutgit/state.db`
- Stores hook definitions, dependencies, and run history for that workspace

Decision: ORM is not limited to hooks. New and existing SQLite-backed features should move to ORM-backed repositories over time.

## Data Model (SQLite via ORM)

Requirement: introduce an ORM layer for this feature instead of raw SQL ad-hoc access.

Recommended path:

- Use `sea-orm` + `sea-query` for cross-platform SQLite support and ergonomic migrations

Why:

- Better schema evolution than hand-maintained SQL strings
- Typed entities for safer command payload handling
- Easier testing/mocking for hook CRUD and execution logs

### User-profile tables

`recent_workspaces`

- `workspace_path` TEXT PRIMARY KEY
- `last_opened_at` INTEGER NOT NULL

`app_settings`

- `key` TEXT PRIMARY KEY
- `value` TEXT NOT NULL

### Workspace tables

`hook_definitions`

- `id` TEXT PRIMARY KEY
- `name` TEXT NOT NULL
- `scope` TEXT NOT NULL (`worktree` | `workspace`)
- `trigger` TEXT NOT NULL
- `shell` TEXT NOT NULL (`bash` | `zsh` | `pwsh`)
- `script` TEXT NOT NULL
- `enabled` INTEGER NOT NULL DEFAULT 1
- `critical` INTEGER NOT NULL DEFAULT 0
- `timeout_seconds` INTEGER NOT NULL DEFAULT 600
- `created_at` INTEGER NOT NULL
- `updated_at` INTEGER NOT NULL

`hook_dependencies`

- `hook_id` TEXT NOT NULL
- `depends_on_hook_id` TEXT NOT NULL
- PRIMARY KEY (`hook_id`, `depends_on_hook_id`)

`hook_dependency_closure` (optional cache table)

- `hook_id` TEXT NOT NULL
- `depends_on_hook_id` TEXT NOT NULL
- `depth` INTEGER NOT NULL
- PRIMARY KEY (`hook_id`, `depends_on_hook_id`)

`hook_runs`

- `id` TEXT PRIMARY KEY
- `hook_id` TEXT NOT NULL
- `trigger` TEXT NOT NULL
- `worktree_path` TEXT NOT NULL
- `status` TEXT NOT NULL (`success` | `failed` | `skipped` | `timed_out`)
- `started_at` INTEGER NOT NULL
- `finished_at` INTEGER NULL
- `exit_code` INTEGER NULL
- `stdout_snippet` TEXT NULL
- `stderr_snippet` TEXT NULL
- `error_message` TEXT NULL

Indexes:

- `idx_hook_definitions_trigger_enabled`
- `idx_hook_dependencies_depends_on`
- `idx_hook_runs_hook_started_at`
- `idx_hook_runs_worktree_started_at`

Notes:

- `workspace_path` is not required in `hook_definitions` because this DB is already workspace-local.
- Dependencies support multi-dependency AND semantics: a hook can run only after all listed dependencies succeed (or are skipped as allowed by policy).
- Use recursive CTE queries for dependency traversal/cycle detection. No non-portable SQLite extensions are required for the base DAG model.

## Execution Model

### Runtime shell selection

Use host OS to decide supported shell. Hook contents are written to a temporary script file, and SproutGit executes that file with the selected shell:

- Linux: execute with `bash <temp-script-file>`
- macOS: execute with `zsh <temp-script-file>`
- Windows: execute with `pwsh -NoLogo -NoProfile -NonInteractive -File <temp-script-file>`

This is file-based execution, not inline `-c`/`-Command` execution, so hook authors should not rely on inline-shell quoting behavior. Relative paths should be evaluated based on the hook process working directory, not the temporary script file location.

If shell executable is unavailable, fail with explicit remediation guidance.

### Parallelism and Dependency Tree

Hooks run concurrently by default once dependency requirements are satisfied.

Rules:

- A hook is runnable only when all dependencies in `hook_dependencies` are completed successfully (AND semantics)
- For non-critical dependencies that fail, downstream hooks are still allowed to run
- Reject invalid dependency graphs (self-cycle or graph cycle)
- Preserve deterministic ordering among currently-runnable hooks by `name ASC`

Suggested behavior for `before_*` triggers:

- Run all groups
- If any critical hook fails, operation is rejected

Suggested behavior for `after_*` triggers:

- Run hooks and collect results
- Always warning-only by default
- Never mutate Git state to attempt rollback

### Environment passed to hooks

Provide minimal, explicit environment variables:

- `SPROUTGIT_WORKSPACE_PATH`
- `SPROUTGIT_WORKSPACE_NAME`
- `SPROUTGIT_ROOT_PATH`
- `SPROUTGIT_WORKTREES_PATH`
- `SPROUTGIT_WORKTREE_PATH`
- `SPROUTGIT_WORKTREE_NAME`
- `SPROUTGIT_WORKTREE_BRANCH`
- `SPROUTGIT_WORKTREE_HEAD`
- `SPROUTGIT_WORKTREE_HEAD_SHORT`
- `SPROUTGIT_WORKTREE_DETACHED`
- `SPROUTGIT_TRIGGER`
- `SPROUTGIT_TRIGGER_PHASE`
- `SPROUTGIT_TRIGGER_ACTION`
- `SPROUTGIT_HOOK_ID`
- `SPROUTGIT_HOOK_NAME`
- `SPROUTGIT_HOOK_SCOPE`
- `SPROUTGIT_HOOK_SHELL`
- `SPROUTGIT_HOOK_CRITICAL`
- `SPROUTGIT_HOOK_TIMEOUT_SECONDS`
- `SPROUTGIT_OS`

Do not pass secrets by default.

## UI and Editor

Add a `Hooks` management surface in the workspace UI:

- List hooks by trigger
- Enable/disable toggles
- Critical toggle
- Timeout input
- Dependency editor (select one or more hook dependencies)
- Run-now action from a worktree row for enabled hooks
- Last run status and logs

Editor requirements:

- Use Monaco editor with syntax highlighting based on shell (`shell` for bash/zsh, `powershell` for pwsh)
- Show shell-specific script template snippets for quick start

## Security and Safety

This feature executes user-defined scripts locally and is high risk by design.

Guardrails:

- Clear warning: hooks execute arbitrary code
- Explicit per-hook confirmation for first run
- Timeout enforcement with process kill
- Output truncation in logs
- No implicit elevation (no admin/sudo prompts managed by SproutGit)
- Strict trigger payload validation (paths, trigger enum)

Non-goals:

- Sandboxing scripts in initial implementation

## Failure Policy (Decided)

- `before_*`: critical hooks gate operation; non-critical hooks do not gate
- `after_*`: warning-only by default (non-blocking)
- Force remove policy: bypass only failing non-critical hooks; critical failures still block
- timeout default: 10 minutes
- max captured output per stream: 64 KB

## Observability

- Persist run records in `hook_runs`
- Surface current run progress in UI
- Keep last N runs per hook (e.g. 200), with periodic pruning

## Remaining Open Questions

1. Should users be allowed to cancel long-running hooks from the UI?
2. Should global machine-wide hooks ever be supported, or should hooks remain workspace-only?

## Rollout Plan

### Phase 1: Persistence + CRUD

- Add ORM and migrations for both config DB and workspace DB
- Move existing app-level state (recent workspaces/settings) to user-profile config DB
- Add hook CRUD APIs (list/create/update/delete/toggle)
- Add Monaco-powered hooks editor

### Phase 2: Execution Engine

- Implement trigger orchestration for create/remove
- Add timeout, logging, and status reporting
- Add test-run action in UI

### Phase 3: Reliability

- Add retry policy (optional, opt-in)
- Add richer log viewer and filtering
- Add diagnostics export for failed hook runs
