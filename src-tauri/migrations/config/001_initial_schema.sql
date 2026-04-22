-- App-global config database: lives in the OS app-data directory

PRAGMA journal_mode = WAL;
PRAGMA synchronous   = NORMAL;
PRAGMA foreign_keys  = ON;
PRAGMA cache_size    = -2048; -- 2 MiB page cache
PRAGMA temp_store    = MEMORY;

CREATE TABLE IF NOT EXISTS app_settings (
    key   TEXT PRIMARY KEY,
    value TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS recent_workspaces (
    workspace_path TEXT    PRIMARY KEY,
    last_opened_at INTEGER NOT NULL
);

-- List query: ORDER BY last_opened_at DESC LIMIT 20
CREATE INDEX IF NOT EXISTS idx_recent_workspaces_last_opened
    ON recent_workspaces (last_opened_at DESC);
