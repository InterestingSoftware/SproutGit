-- Workspace-scoped database: lives at <workspace>/.sproutgit/state.db

CREATE TABLE IF NOT EXISTS meta (
    key   TEXT PRIMARY KEY,
    value TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS recent_repositories (
    repo_path      TEXT    PRIMARY KEY,
    last_opened_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS worktree_sessions (
    worktree_path  TEXT PRIMARY KEY,
    last_branch    TEXT,
    last_opened_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS hook_definitions (
    id              TEXT    PRIMARY KEY,
    name            TEXT    NOT NULL,
    scope           TEXT    NOT NULL DEFAULT 'worktree',
    trigger         TEXT    NOT NULL,
    shell           TEXT    NOT NULL,
    script          TEXT    NOT NULL,
    enabled         INTEGER NOT NULL DEFAULT 1,
    critical        INTEGER NOT NULL DEFAULT 0,
    timeout_seconds INTEGER NOT NULL DEFAULT 600,
    created_at      INTEGER NOT NULL,
    updated_at      INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS hook_dependencies (
    hook_id            TEXT NOT NULL REFERENCES hook_definitions(id) ON DELETE CASCADE,
    depends_on_hook_id TEXT NOT NULL REFERENCES hook_definitions(id) ON DELETE CASCADE,
    PRIMARY KEY (hook_id, depends_on_hook_id)
);

CREATE TABLE IF NOT EXISTS hook_runs (
    id             TEXT    PRIMARY KEY,
    hook_id        TEXT    NOT NULL REFERENCES hook_definitions(id) ON DELETE CASCADE,
    trigger        TEXT    NOT NULL,
    worktree_path  TEXT    NOT NULL,
    status         TEXT    NOT NULL,
    started_at     INTEGER NOT NULL,
    finished_at    INTEGER,
    exit_code      INTEGER,
    stdout_snippet TEXT,
    stderr_snippet TEXT,
    error_message  TEXT
);

-- Hot path: load enabled hooks for a trigger, sorted by name for deterministic ordering.
-- Covers the WHERE and eliminates the sort (trigger, enabled, name all in index).
CREATE INDEX IF NOT EXISTS idx_hook_definitions_trigger_enabled_name
    ON hook_definitions (trigger, enabled, name);

-- Reverse-dependency lookup used by the dependency graph cycle checker.
CREATE INDEX IF NOT EXISTS idx_hook_dependencies_depends_on
    ON hook_dependencies (depends_on_hook_id);

-- Hook run history queries: lookup by hook or by worktree, both ordered by time.
CREATE INDEX IF NOT EXISTS idx_hook_runs_hook_started_at
    ON hook_runs (hook_id, started_at);

CREATE INDEX IF NOT EXISTS idx_hook_runs_worktree_started_at
    ON hook_runs (worktree_path, started_at);
