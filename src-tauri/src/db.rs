use sea_orm::{ConnectionTrait, Database, DatabaseConnection, Statement};
use std::fs;
use std::path::{Path, PathBuf};

use crate::git::helpers::{ensure_directory, normalize_existing_path};

fn sqlite_url_for_path(db_path: &Path) -> String {
    let normalized = db_path
        .to_string_lossy()
        .replace('\\', "/")
        .replace(' ', "%20");

    // Windows drive-letter paths need an explicit extra slash.
    if normalized.as_bytes().get(1).is_some_and(|b| *b == b':') {
        return format!("sqlite:///{}?mode=rwc", normalized);
    }

    format!("sqlite://{}?mode=rwc", normalized)
}

async fn connect_sqlite(db_path: &Path) -> Result<DatabaseConnection, String> {
    if let Some(parent) = db_path.parent() {
        ensure_directory(parent)?;
    }

    let url = sqlite_url_for_path(db_path);
    Database::connect(url)
        .await
        .map_err(|e| format!("Failed to open sqlite database: {e}"))
}

async fn ensure_config_schema(conn: &DatabaseConnection) -> Result<(), String> {
    conn.execute(Statement::from_string(
        sea_orm::DatabaseBackend::Sqlite,
        "
        CREATE TABLE IF NOT EXISTS app_settings (
            key TEXT PRIMARY KEY,
            value TEXT NOT NULL
        );

        CREATE TABLE IF NOT EXISTS recent_workspaces (
            workspace_path TEXT PRIMARY KEY,
            last_opened_at INTEGER NOT NULL
        );
        "
        .to_string(),
    ))
    .await
    .map_err(|e| format!("Failed to initialize config schema: {e}"))?;

    Ok(())
}

async fn ensure_workspace_schema(conn: &DatabaseConnection) -> Result<(), String> {
    conn.execute(Statement::from_string(
        sea_orm::DatabaseBackend::Sqlite,
        "
        CREATE TABLE IF NOT EXISTS meta (
            key TEXT PRIMARY KEY,
            value TEXT NOT NULL
        );

        CREATE TABLE IF NOT EXISTS recent_repositories (
            repo_path TEXT PRIMARY KEY,
            last_opened_at INTEGER NOT NULL
        );

        CREATE TABLE IF NOT EXISTS worktree_sessions (
            worktree_path TEXT PRIMARY KEY,
            last_branch TEXT,
            last_opened_at INTEGER NOT NULL
        );

        CREATE TABLE IF NOT EXISTS hook_definitions (
            id TEXT PRIMARY KEY,
            name TEXT NOT NULL,
            scope TEXT NOT NULL DEFAULT 'worktree',
            trigger TEXT NOT NULL,
            shell TEXT NOT NULL,
            script TEXT NOT NULL,
            enabled INTEGER NOT NULL DEFAULT 1,
            critical INTEGER NOT NULL DEFAULT 0,
            timeout_seconds INTEGER NOT NULL DEFAULT 600,
            created_at INTEGER NOT NULL,
            updated_at INTEGER NOT NULL
        );

        CREATE TABLE IF NOT EXISTS hook_dependencies (
            hook_id TEXT NOT NULL,
            depends_on_hook_id TEXT NOT NULL,
            PRIMARY KEY (hook_id, depends_on_hook_id)
        );

        CREATE TABLE IF NOT EXISTS hook_runs (
            id TEXT PRIMARY KEY,
            hook_id TEXT NOT NULL,
            trigger TEXT NOT NULL,
            worktree_path TEXT NOT NULL,
            status TEXT NOT NULL,
            started_at INTEGER NOT NULL,
            finished_at INTEGER NULL,
            exit_code INTEGER NULL,
            stdout_snippet TEXT NULL,
            stderr_snippet TEXT NULL,
            error_message TEXT NULL
        );

        CREATE INDEX IF NOT EXISTS idx_hook_definitions_trigger_enabled
            ON hook_definitions(trigger, enabled);

        CREATE INDEX IF NOT EXISTS idx_hook_dependencies_depends_on
            ON hook_dependencies(depends_on_hook_id);

        CREATE INDEX IF NOT EXISTS idx_hook_runs_hook_started_at
            ON hook_runs(hook_id, started_at);

        CREATE INDEX IF NOT EXISTS idx_hook_runs_worktree_started_at
            ON hook_runs(worktree_path, started_at);
        "
        .to_string(),
    ))
    .await
    .map_err(|e| format!("Failed to initialize workspace schema: {e}"))?;

    ensure_workspace_schema_migrations(conn).await
}

async fn sqlite_table_has_column(
    conn: &DatabaseConnection,
    table_name: &str,
    column_name: &str,
) -> Result<bool, String> {
    let pragma = format!("PRAGMA table_info({table_name})");
    let rows = conn
        .query_all(Statement::from_string(
            sea_orm::DatabaseBackend::Sqlite,
            pragma,
        ))
        .await
        .map_err(|e| format!("Failed to inspect sqlite table '{table_name}': {e}"))?;

    for row in rows {
        let name = row
            .try_get::<String>("", "name")
            .map_err(|e| format!("Failed to read sqlite column metadata: {e}"))?;
        if name == column_name {
            return Ok(true);
        }
    }

    Ok(false)
}

async fn ensure_workspace_schema_migrations(conn: &DatabaseConnection) -> Result<(), String> {
    if !sqlite_table_has_column(conn, "hook_definitions", "scope").await? {
        conn.execute(Statement::from_string(
            sea_orm::DatabaseBackend::Sqlite,
            "
            ALTER TABLE hook_definitions
            ADD COLUMN scope TEXT NOT NULL DEFAULT 'worktree';
            "
            .to_string(),
        ))
        .await
        .map_err(|e| format!("Failed to migrate hook_definitions scope column: {e}"))?;

        conn.execute(Statement::from_string(
            sea_orm::DatabaseBackend::Sqlite,
            "
            UPDATE hook_definitions
            SET scope = 'worktree'
            WHERE scope IS NULL OR TRIM(scope) = '';
            "
            .to_string(),
        ))
        .await
        .map_err(|e| format!("Failed to backfill hook scope values: {e}"))?;
    }

    conn.execute(Statement::from_string(
        sea_orm::DatabaseBackend::Sqlite,
        "
        CREATE INDEX IF NOT EXISTS idx_hook_definitions_scope_trigger_enabled
            ON hook_definitions(scope, trigger, enabled);
        "
        .to_string(),
    ))
    .await
    .map_err(|e| format!("Failed to ensure hook scope index: {e}"))?;

    Ok(())
}

fn config_db_path() -> Result<PathBuf, String> {
    #[cfg(target_os = "macos")]
    {
        let home = std::env::var("HOME")
            .map_err(|_| "Cannot determine HOME for config database".to_string())?;
        return Ok(PathBuf::from(home)
            .join("Library")
            .join("Application Support")
            .join("SproutGit")
            .join("config.db"));
    }

    #[cfg(target_os = "linux")]
    {
        if let Ok(xdg_config_home) = std::env::var("XDG_CONFIG_HOME") {
            return Ok(PathBuf::from(xdg_config_home)
                .join("SproutGit")
                .join("config.db"));
        }

        let home = std::env::var("HOME")
            .map_err(|_| "Cannot determine HOME for config database".to_string())?;
        return Ok(PathBuf::from(home)
            .join(".config")
            .join("SproutGit")
            .join("config.db"));
    }

    #[cfg(target_os = "windows")]
    {
        if let Ok(appdata) = std::env::var("APPDATA") {
            return Ok(PathBuf::from(appdata).join("SproutGit").join("config.db"));
        }

        let profile = std::env::var("USERPROFILE")
            .map_err(|_| "Cannot determine USERPROFILE for config database".to_string())?;
        return Ok(PathBuf::from(profile)
            .join("AppData")
            .join("Roaming")
            .join("SproutGit")
            .join("config.db"));
    }

    #[allow(unreachable_code)]
    Err("Unsupported platform for config database location".to_string())
}

pub async fn connect_config_db() -> Result<DatabaseConnection, String> {
    let path = config_db_path()?;
    let conn = connect_sqlite(&path).await?;
    ensure_config_schema(&conn).await?;
    Ok(conn)
}

pub async fn connect_workspace_db(workspace_path: &str) -> Result<DatabaseConnection, String> {
    let workspace = normalize_existing_path(workspace_path)?;
    let db_path = workspace.join(".sproutgit").join("state.db");
    let conn = connect_sqlite(&db_path).await?;
    ensure_workspace_schema(&conn).await?;
    Ok(conn)
}

pub async fn initialize_workspace_db(workspace_path: &Path) -> Result<(), String> {
    let metadata_path = workspace_path.join(".sproutgit");
    ensure_directory(&metadata_path)?;
    let db_path = metadata_path.join("state.db");

    if !db_path.exists() {
        fs::File::create(&db_path)
            .map_err(|e| format!("Failed to create workspace state database: {e}"))?;
    }

    let conn = connect_sqlite(&db_path).await?;
    ensure_workspace_schema(&conn).await
}
