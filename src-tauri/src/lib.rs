use serde::Serialize;
use std::path::{Path, PathBuf};
use std::process::Command;

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct GitInfo {
    installed: bool,
    version: Option<String>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct WorktreeInfo {
    path: String,
    head: Option<String>,
    branch: Option<String>,
    detached: bool,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct WorktreeListResult {
    repo_path: String,
    worktrees: Vec<WorktreeInfo>,
}

#[tauri::command]
fn git_info() -> GitInfo {
    match Command::new("git").arg("--version").output() {
        Ok(output) if output.status.success() => {
            let version = String::from_utf8_lossy(&output.stdout).trim().to_string();
            GitInfo {
                installed: true,
                version: Some(version),
            }
        }
        _ => GitInfo {
            installed: false,
            version: None,
        },
    }
}

fn normalize_path(input: &str) -> Result<PathBuf, String> {
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

#[tauri::command]
fn list_worktrees(repo_path: String) -> Result<WorktreeListResult, String> {
    let canonical = normalize_path(&repo_path)?;

    let output = Command::new("git")
        .arg("-C")
        .arg(&canonical)
        .arg("worktree")
        .arg("list")
        .arg("--porcelain")
        .output()
        .map_err(|e| format!("Failed to run git worktree list: {e}"))?;

    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr).trim().to_string();
        if stderr.is_empty() {
            return Err("Path is not a Git repository".to_string());
        }
        return Err(stderr);
    }

    let stdout = String::from_utf8_lossy(&output.stdout);
    let mut worktrees: Vec<WorktreeInfo> = Vec::new();
    let mut current: Option<WorktreeInfo> = None;

    for line in stdout.lines() {
        if line.trim().is_empty() {
            if let Some(item) = current.take() {
                worktrees.push(item);
            }
            continue;
        }

        if let Some(rest) = line.strip_prefix("worktree ") {
            if let Some(item) = current.take() {
                worktrees.push(item);
            }
            current = Some(WorktreeInfo {
                path: rest.to_string(),
                head: None,
                branch: None,
                detached: false,
            });
            continue;
        }

        if let Some(item) = current.as_mut() {
            if let Some(rest) = line.strip_prefix("HEAD ") {
                item.head = Some(rest.to_string());
            } else if let Some(rest) = line.strip_prefix("branch ") {
                item.branch = Some(rest.replace("refs/heads/", ""));
            } else if line == "detached" {
                item.detached = true;
            }
        }
    }

    if let Some(item) = current.take() {
        worktrees.push(item);
    }

    Ok(WorktreeListResult {
        repo_path: canonical.to_string_lossy().to_string(),
        worktrees,
    })
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
    .invoke_handler(tauri::generate_handler![git_info, list_worktrees])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
