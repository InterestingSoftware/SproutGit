use rusqlite::{params, Connection};
use std::fs;
use std::path::{Path, PathBuf};
use std::process::Command;
use std::time::{SystemTime, UNIX_EPOCH};

/// Returns a PATH string that prepends common macOS install directories
/// (Homebrew, /usr/local) so that GUI-launched Tauri processes find the
/// same binaries the user's shell would.
pub fn augmented_path() -> String {
    let current = std::env::var("PATH").unwrap_or_default();
    let extra = [
        "/opt/homebrew/bin",
        "/opt/homebrew/sbin",
        "/usr/local/bin",
        "/usr/local/sbin",
    ];
    let mut parts: Vec<&str> = extra.to_vec();
    for segment in current.split(':') {
        if !parts.contains(&segment) {
            parts.push(segment);
        }
    }
    parts.join(":")
}

pub fn normalize_existing_path(input: &str) -> Result<PathBuf, String> {
    let trimmed = input.trim();
    if trimmed.is_empty() {
        return Err("Repository path is required".to_string());
    }

    let path = Path::new(trimmed);
    if !path.exists() {
        return Err("Repository path does not exist".to_string());
    }

    if !path.is_dir() {
        return Err("Repository path must be a directory".to_string());
    }

    path.canonicalize()
        .map_err(|_| "Failed to resolve repository path".to_string())
}

pub fn normalize_or_create_dir(input: &str) -> Result<PathBuf, String> {
    let trimmed = input.trim();
    if trimmed.is_empty() {
        return Err("Workspace path is required".to_string());
    }

    let path = Path::new(trimmed);
    if path.exists() {
        if !path.is_dir() {
            return Err("Workspace path must be a directory".to_string());
        }
    } else {
        fs::create_dir_all(path).map_err(|e| format!("Failed to create workspace directory: {e}"))?;
    }

    path.canonicalize()
        .map_err(|_| "Failed to resolve workspace path".to_string())
}

pub fn now_epoch_seconds() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_secs())
        .unwrap_or(0)
}

pub fn ensure_directory(path: &Path) -> Result<(), String> {
    if path.exists() {
        if !path.is_dir() {
            return Err(format!("Expected directory but found file: {}", path.display()));
        }
        return Ok(());
    }

    fs::create_dir_all(path).map_err(|e| format!("Failed to create directory {}: {e}", path.display()))
}

pub fn run_git(args: &[&str]) -> Result<std::process::Output, String> {
    Command::new("git")
        .args(args)
        .env("PATH", augmented_path())
        .output()
        .map_err(|e| format!("Failed to run git command: {e}"))
}

pub fn ensure_git_success(output: std::process::Output, fallback_message: &str) -> Result<std::process::Output, String> {
    if output.status.success() {
        return Ok(output);
    }

    let stderr = String::from_utf8_lossy(&output.stderr).trim().to_string();
    if stderr.is_empty() {
        return Err(fallback_message.to_string());
    }
    Err(stderr)
}

pub fn slugify_for_path(name: &str) -> String {
    let mut output = String::with_capacity(name.len());
    let mut previous_dash = false;

    for ch in name.chars() {
        let is_word = ch.is_ascii_alphanumeric() || ch == '_' || ch == '-';
        if is_word {
            output.push(ch.to_ascii_lowercase());
            previous_dash = false;
        } else if !previous_dash {
            output.push('-');
            previous_dash = true;
        }
    }

    output.trim_matches('-').to_string()
}

pub fn initialize_state_db(state_db_path: &Path) -> Result<(), String> {
    let conn = Connection::open(state_db_path)
        .map_err(|e| format!("Failed to open workspace state database: {e}"))?;

    conn.execute_batch(
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
        ",
    )
    .map_err(|e| format!("Failed to initialize workspace schema: {e}"))?;

    conn.execute(
        "INSERT OR REPLACE INTO meta(key, value) VALUES(?1, ?2)",
        params!["schema_version", "1"],
    )
    .map_err(|e| format!("Failed to write schema metadata: {e}"))?;

    conn.execute(
        "INSERT OR REPLACE INTO meta(key, value) VALUES(?1, ?2)",
        params!["updated_at", now_epoch_seconds().to_string()],
    )
    .map_err(|e| format!("Failed to write update metadata: {e}"))?;

    Ok(())
}
