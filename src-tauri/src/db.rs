use rusqlite_migration::{Migrations, M};
use sea_orm::{ConnectionTrait, Database, DatabaseConnection, Statement};
use std::path::{Path, PathBuf};
use std::sync::LazyLock;

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

static WORKSPACE_MIGRATIONS: LazyLock<Migrations<'static>> = LazyLock::new(|| {
    Migrations::new(vec![
        M::up(include_str!(
            "../migrations/workspace/001_initial_schema.sql"
        )),
        M::up(include_str!(
            "../migrations/workspace/002_hook_keep_open_on_completion.sql"
        )),
        M::up(include_str!(
            "../migrations/workspace/003_hook_execution_preferences.sql"
        )),
    ])
});

static CONFIG_MIGRATIONS: LazyLock<Migrations<'static>> = LazyLock::new(|| {
    Migrations::new(vec![M::up(include_str!(
        "../migrations/config/001_initial_schema.sql"
    ))])
});

fn run_workspace_migrations(db_path: &Path) -> Result<(), String> {
    if let Some(parent) = db_path.parent() {
        ensure_directory(parent)?;
    }
    let mut conn = rusqlite::Connection::open(db_path)
        .map_err(|e| format!("Failed to open workspace database for migration: {e}"))?;
    apply_connection_pragmas(&conn)?;
    WORKSPACE_MIGRATIONS
        .to_latest(&mut conn)
        .map_err(|e| format!("Workspace database migration failed: {e}"))
}

fn run_config_migrations(db_path: &Path) -> Result<(), String> {
    if let Some(parent) = db_path.parent() {
        ensure_directory(parent)?;
    }
    let mut conn = rusqlite::Connection::open(db_path)
        .map_err(|e| format!("Failed to open config database for migration: {e}"))?;
    apply_connection_pragmas(&conn)?;
    CONFIG_MIGRATIONS
        .to_latest(&mut conn)
        .map_err(|e| format!("Config database migration failed: {e}"))
}

/// Apply connection-level PRAGMAs that must be set on every connection open,
/// not just at schema creation time.
fn apply_connection_pragmas(conn: &rusqlite::Connection) -> Result<(), String> {
    conn.execute_batch(
        "
        PRAGMA journal_mode = WAL;
        PRAGMA synchronous   = NORMAL;
        PRAGMA foreign_keys  = ON;
        PRAGMA cache_size    = -4096;
        PRAGMA temp_store    = MEMORY;
        ",
    )
    .map_err(|e| format!("Failed to apply connection PRAGMAs: {e}"))
}

fn config_db_path() -> Result<PathBuf, String> {
    if let Ok(override_path) = std::env::var("SPROUTGIT_CONFIG_DB_PATH") {
        let trimmed = override_path.trim();
        if !trimmed.is_empty() {
            return Ok(PathBuf::from(trimmed));
        }
    }

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
    run_config_migrations(&path)?;
    connect_sqlite(&path).await
}

pub async fn connect_workspace_db(workspace_path: &str) -> Result<DatabaseConnection, String> {
    let workspace = normalize_existing_path(workspace_path)?;
    let db_path = workspace.join(".sproutgit").join("state.db");
    run_workspace_migrations(&db_path)?;
    connect_sqlite(&db_path).await
}

pub async fn initialize_workspace_db(workspace_path: &Path) -> Result<(), String> {
    let db_path = workspace_path.join(".sproutgit").join("state.db");
    run_workspace_migrations(&db_path)
}

/// Write identifying metadata about a workspace into the `meta` table.
///
/// Uses `INSERT OR IGNORE` so that `created_at` and other values set on first
/// creation are never overwritten by subsequent calls (e.g. during backfill).
pub async fn write_workspace_meta(
    db_path: &Path,
    workspace: &Path,
    root_path: &Path,
    worktrees_path: &Path,
    state_db_path: &Path,
) -> Result<(), String> {
    use crate::git::helpers::{now_epoch_seconds, path_to_frontend};

    let conn = connect_sqlite(db_path).await?;

    let pairs: [(&str, String); 6] = [
        ("project_version", "1".to_string()),
        ("created_at", now_epoch_seconds().to_string()),
        ("workspace_path", path_to_frontend(workspace)),
        ("root_path", path_to_frontend(root_path)),
        ("worktrees_path", path_to_frontend(worktrees_path)),
        ("state_db_path", path_to_frontend(state_db_path)),
    ];

    for (key, value) in &pairs {
        conn.execute(Statement::from_sql_and_values(
            sea_orm::DatabaseBackend::Sqlite,
            "INSERT OR IGNORE INTO meta (key, value) VALUES (?, ?)",
            [
                sea_orm::Value::String(Some(Box::new((*key).to_string()))),
                sea_orm::Value::String(Some(Box::new(value.clone()))),
            ],
        ))
        .await
        .map_err(|e| format!("Failed to write workspace meta '{key}': {e}"))?;
    }

    Ok(())
}
