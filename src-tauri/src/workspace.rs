use serde::Serialize;
use serde_json::json;
use std::fs;
use std::io::{BufReader, Read};
use std::process::Stdio;

use crate::git::helpers::{
    ensure_directory, git_command, initialize_state_db, normalize_existing_path,
    normalize_or_create_dir, now_epoch_seconds, validate_repo_url, GitAction,
};
use crate::github::git_auth_env;

// ── Structs ──

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct WorkspaceInitResult {
    pub workspace_path: String,
    pub root_path: String,
    pub worktrees_path: String,
    pub metadata_path: String,
    pub state_db_path: String,
    pub cloned: bool,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct WorkspaceStatus {
    pub workspace_path: String,
    pub root_path: String,
    pub worktrees_path: String,
    pub metadata_path: String,
    pub state_db_path: String,
    pub is_sproutgit_project: bool,
    pub root_exists: bool,
    pub worktrees_exists: bool,
    pub metadata_exists: bool,
    pub state_db_exists: bool,
}

// ── Commands ──

#[tauri::command]
pub async fn create_sproutgit_workspace(
    app_handle: tauri::AppHandle,
    workspace_path: String,
    repo_url: Option<String>,
) -> Result<WorkspaceInitResult, String> {
    let workspace = normalize_or_create_dir(&workspace_path)?;
    let root_path = workspace.join("root");
    let worktrees_path = workspace.join("worktrees");
    let metadata_path = workspace.join(".sproutgit");
    let state_db_path = metadata_path.join("state.db");
    let project_marker_path = metadata_path.join("project.json");

    ensure_directory(&root_path)?;
    ensure_directory(&worktrees_path)?;
    ensure_directory(&metadata_path)?;

    initialize_state_db(&state_db_path)?;

    if !project_marker_path.exists() {
        let marker = json!({
            "projectVersion": 1,
            "createdAt": now_epoch_seconds(),
            "workspacePath": workspace.to_string_lossy(),
            "rootPath": root_path.to_string_lossy(),
            "worktreesPath": worktrees_path.to_string_lossy(),
            "stateDbPath": state_db_path.to_string_lossy(),
        });

        let marker_pretty = serde_json::to_string_pretty(&marker)
            .map_err(|e| format!("Failed to serialize project marker: {e}"))?;
        fs::write(&project_marker_path, marker_pretty)
            .map_err(|e| format!("Failed to write project marker: {e}"))?;
    }

    let repo_url = repo_url
        .as_deref()
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(String::from);

    let mut cloned = false;

    if let Some(url) = repo_url {
        let url = validate_repo_url(&url)?;
        let root_has_content = fs::read_dir(&root_path)
            .map_err(|e| format!("Failed to inspect root directory: {e}"))?
            .next()
            .is_some();

        if root_has_content {
            return Err("Cannot clone into root/: directory is not empty".to_string());
        }

        use tauri::Emitter;

        let _ = app_handle.emit("clone-progress", "Connecting...");

        let root_path_string = root_path.to_string_lossy().to_string();
        let mut child = git_command(
            GitAction::Clone,
            &["clone", "--progress", &url, &root_path_string],
        )
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .envs(git_auth_env())
        .spawn()
        .map_err(|e| format!("Failed to run git clone: {e}"))?;

        if let Some(stderr) = child.stderr.take() {
            let reader = BufReader::new(stderr);
            let mut line_buf = String::new();
            for byte in reader.bytes() {
                match byte {
                    Ok(b'\r') | Ok(b'\n') => {
                        let trimmed = line_buf.trim().to_string();
                        if !trimmed.is_empty() {
                            let _ = app_handle.emit("clone-progress", &trimmed);
                        }
                        line_buf.clear();
                    },
                    Ok(b) => line_buf.push(b as char),
                    Err(_) => break,
                }
            }
            let trimmed = line_buf.trim().to_string();
            if !trimmed.is_empty() {
                let _ = app_handle.emit("clone-progress", &trimmed);
            }
        }

        let status = child
            .wait()
            .map_err(|e| format!("Failed to wait for git clone: {e}"))?;

        if !status.success() {
            let _ = app_handle.emit("clone-progress", "Clone failed");
            return Err("git clone failed".to_string());
        }

        let _ = app_handle.emit("clone-progress", "Done");
        cloned = true;
    } else if !root_path.join(".git").exists() {
        let root_path_string = root_path.to_string_lossy().to_string();
        let init_output = git_command(GitAction::Init, &["-C", &root_path_string, "init"])
            .output()
            .map_err(|e| format!("Failed to initialize git repository: {e}"))?;

        if !init_output.status.success() {
            let stderr = String::from_utf8_lossy(&init_output.stderr)
                .trim()
                .to_string();
            if stderr.is_empty() {
                return Err("git init failed".to_string());
            }
            return Err(stderr);
        }
    }

    Ok(WorkspaceInitResult {
        workspace_path: workspace.to_string_lossy().to_string(),
        root_path: root_path.to_string_lossy().to_string(),
        worktrees_path: worktrees_path.to_string_lossy().to_string(),
        metadata_path: metadata_path.to_string_lossy().to_string(),
        state_db_path: state_db_path.to_string_lossy().to_string(),
        cloned,
    })
}

#[tauri::command]
pub async fn inspect_sproutgit_workspace(
    workspace_path: String,
) -> Result<WorkspaceStatus, String> {
    let workspace = normalize_existing_path(&workspace_path)?;

    let root_path = workspace.join("root");
    let worktrees_path = workspace.join("worktrees");
    let metadata_path = workspace.join(".sproutgit");
    let state_db_path = metadata_path.join("state.db");
    let project_marker_path = metadata_path.join("project.json");

    Ok(WorkspaceStatus {
        workspace_path: workspace.to_string_lossy().to_string(),
        root_path: root_path.to_string_lossy().to_string(),
        worktrees_path: worktrees_path.to_string_lossy().to_string(),
        metadata_path: metadata_path.to_string_lossy().to_string(),
        state_db_path: state_db_path.to_string_lossy().to_string(),
        is_sproutgit_project: project_marker_path.exists(),
        root_exists: root_path.exists(),
        worktrees_exists: worktrees_path.exists(),
        metadata_exists: metadata_path.exists(),
        state_db_exists: state_db_path.exists(),
    })
}
