use serde::{Deserialize, Serialize};
use serde_json::json;
use std::collections::VecDeque;
use std::fs;
use std::io::{BufReader, Read};
use std::process::Stdio;

use crate::db::initialize_workspace_db;
use crate::git::helpers::{
    ensure_directory, git_command, normalize_existing_path, normalize_or_create_dir,
    now_epoch_seconds, validate_repo_url, GitAction,
};
use crate::github::git_clone_auth_context;

fn write_project_marker(
    project_marker_path: &std::path::Path,
    workspace: &std::path::Path,
    root_path: &std::path::Path,
    worktrees_path: &std::path::Path,
    state_db_path: &std::path::Path,
) -> Result<(), String> {
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
    fs::write(project_marker_path, marker_pretty)
        .map_err(|e| format!("Failed to write project marker: {e}"))
}

fn validate_clean_git_repo(repo_path: &std::path::Path) -> Result<(), String> {
    let repo_str = repo_path.to_string_lossy().to_string();

    let inside_output = git_command(
        GitAction::RevParse,
        &["-C", &repo_str, "rev-parse", "--is-inside-work-tree"],
    )
    .output()
    .map_err(|e| format!("Failed to inspect repository: {e}"))?;

    if !inside_output.status.success() {
        return Err("Selected path is not a Git working tree".to_string());
    }

    let status_output = git_command(
        GitAction::StatusPorcelain,
        &["-C", &repo_str, "status", "--porcelain"],
    )
    .output()
    .map_err(|e| format!("Failed to inspect repository status: {e}"))?;

    if !status_output.status.success() {
        let stderr = String::from_utf8_lossy(&status_output.stderr)
            .trim()
            .to_string();
        return Err(if stderr.is_empty() {
            "Failed to read repository status".to_string()
        } else {
            stderr
        });
    }

    if !String::from_utf8_lossy(&status_output.stdout)
        .trim()
        .is_empty()
    {
        return Err(
            "Repository has uncommitted changes. Commit or reset your working tree before import."
                .to_string(),
        );
    }

    Ok(())
}

fn is_git_error_line(line: &str) -> bool {
    line.get(..6).is_some_and(|prefix| {
        prefix.eq_ignore_ascii_case("fatal:") || prefix.eq_ignore_ascii_case("error:")
    })
}

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

#[derive(Clone, Copy, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum ImportRepoMode {
    InPlace,
    Move,
    Copy,
}

fn finalize_workspace(
    workspace: &std::path::Path,
    root_path: &std::path::Path,
    worktrees_path: &std::path::Path,
    metadata_path: &std::path::Path,
    state_db_path: &std::path::Path,
    cloned: bool,
) -> Result<WorkspaceInitResult, String> {
    let project_marker_path = metadata_path.join("project.json");

    if !project_marker_path.exists() {
        write_project_marker(
            &project_marker_path,
            workspace,
            root_path,
            worktrees_path,
            state_db_path,
        )?;
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

fn count_files_recursive(path: &std::path::Path) -> Result<usize, String> {
    let rd = fs::read_dir(path).map_err(|e| {
        format!(
            "Failed to read directory while counting files '{}': {e}",
            path.display()
        )
    })?;
    let mut total = 0usize;

    for entry in rd {
        let entry = entry.map_err(|e| {
            format!(
                "Failed to read directory entry while counting files in '{}': {e}",
                path.display()
            )
        })?;
        let entry_path = entry.path();
        let ft = entry.file_type().map_err(|e| {
            format!(
                "Failed to read file type while counting files '{}': {e}",
                entry_path.display()
            )
        })?;
        if ft.is_dir() {
            total += count_files_recursive(&entry_path)?;
        } else if ft.is_file() {
            total += 1;
        }
    }

    Ok(total)
}

/// Recursive directory copy with per-file progress callback.
/// `progress(copied, total)` is called after each file is written.
fn copy_dir_recursive_with_progress(
    src: &std::path::Path,
    dst: &std::path::Path,
    copied: &mut usize,
    total: usize,
    progress: &dyn Fn(usize, usize),
) -> Result<(), String> {
    ensure_directory(dst)?;

    for entry in fs::read_dir(src).map_err(|e| format!("Failed to read source directory: {e}"))? {
        let entry = entry.map_err(|e| format!("Failed to read source entry: {e}"))?;
        let src_path = entry.path();
        let dst_path = dst.join(entry.file_name());
        let ft = entry
            .file_type()
            .map_err(|e| format!("Failed to read file type: {e}"))?;

        if ft.is_dir() {
            copy_dir_recursive_with_progress(&src_path, &dst_path, copied, total, progress)?;
        } else if ft.is_file() {
            fs::copy(&src_path, &dst_path)
                .map_err(|e| format!("Failed to copy file '{}': {e}", src_path.display()))?;
            *copied += 1;
            progress(*copied, total);
        } else if ft.is_symlink() {
            return Err(format!(
                "Import does not support symbolic links: {}",
                src_path.display()
            ));
        }
    }

    Ok(())
}

/// Pure filesystem import logic — no Tauri dependency.
/// `progress` is called with short status strings for the UI.
pub(crate) fn import_repo_filesystem(
    workspace: &std::path::Path,
    source_repo: &std::path::Path,
    mode: ImportRepoMode,
    progress: &dyn Fn(&str),
) -> Result<(), String> {
    let root_path = workspace.join("root");
    let worktrees_path = workspace.join("worktrees");
    let metadata_path = workspace.join(".sproutgit");

    match mode {
        ImportRepoMode::InPlace => {
            // Collision check MUST happen before any directories are created so that
            // we don't falsely flag the dirs we are about to create ourselves.
            let reserved = ["root", "worktrees", ".sproutgit"];
            let entries = fs::read_dir(workspace)
                .map_err(|e| format!("Failed to inspect repository directory: {e}"))?
                .collect::<Result<Vec<_>, _>>()
                .map_err(|e| format!("Failed to inspect repository entry: {e}"))?;

            let collisions = entries
                .iter()
                .filter_map(|entry| {
                    let name = entry.file_name();
                    let name_str = name.to_string_lossy();
                    reserved
                        .iter()
                        .any(|reserved_name| *reserved_name == name_str)
                        .then(|| name_str.into_owned())
                })
                .collect::<Vec<_>>();

            if !collisions.is_empty() {
                return Err(format!(
                    "Cannot import repository in place: repository contains reserved workspace path(s): {}",
                    collisions.join(", ")
                ));
            }

            progress("Organizing workspace structure\u{2026}");

            // Create root/ first, then move all existing repo entries into it.
            ensure_directory(&root_path)?;

            for entry in entries {
                let from = entry.path();
                let to = root_path.join(entry.file_name());
                fs::rename(&from, &to).map_err(|e| {
                    format!(
                        "Failed to move '{}' into workspace root: {e}",
                        from.display()
                    )
                })?;
            }

            // Create the remaining workspace structure after the move is done.
            ensure_directory(&worktrees_path)?;
            ensure_directory(&metadata_path)?;
        },
        ImportRepoMode::Copy | ImportRepoMode::Move => {
            ensure_directory(&root_path)?;
            ensure_directory(&worktrees_path)?;
            ensure_directory(&metadata_path)?;

            let root_has_content = fs::read_dir(&root_path)
                .map_err(|e| format!("Failed to inspect root directory: {e}"))?
                .next()
                .is_some();

            if root_has_content {
                return Err("Cannot import into root/: directory is not empty".to_string());
            }

            match mode {
                ImportRepoMode::Copy => {
                    progress("Counting files\u{2026}");
                    let total = count_files_recursive(source_repo)?;
                    let mut copied = 0usize;
                    copy_dir_recursive_with_progress(
                        source_repo,
                        &root_path,
                        &mut copied,
                        total,
                        &|n, t| {
                            if let Some(pct) =
                                n.checked_mul(100).and_then(|value| value.checked_div(t))
                            {
                                progress(&format!("Copying files\u{2026} {pct}% ({n} of {t})"));
                            }
                        },
                    )?;
                },
                ImportRepoMode::Move => {
                    progress("Moving repository\u{2026}");

                    fs::remove_dir(&root_path).map_err(|e| {
                        format!("Failed to prepare root directory for move import: {e}")
                    })?;

                    match fs::rename(source_repo, &root_path) {
                        Ok(_) => {},
                        Err(_) => {
                            // Cross-filesystem fallback: count files first so we can
                            // report meaningful progress during the copy.
                            let total = count_files_recursive(source_repo)?;
                            let mut copied = 0usize;
                            copy_dir_recursive_with_progress(
                                source_repo,
                                &root_path,
                                &mut copied,
                                total,
                                &|n, t| {
                                    if let Some(pct) =
                                        n.checked_mul(100).and_then(|value| value.checked_div(t))
                                    {
                                        progress(&format!(
                                            "Copying files\u{2026} {pct}% ({n} of {t})"
                                        ));
                                    }
                                },
                            )?;
                            fs::remove_dir_all(source_repo).map_err(|e| {
                                format!(
                                    "Failed to remove source repository after copy fallback: {e}"
                                )
                            })?;
                        },
                    }
                },
                ImportRepoMode::InPlace => unreachable!(),
            }
        },
    }

    Ok(())
}

fn import_repo_with_mode(
    workspace: &std::path::Path,
    source_repo: &std::path::Path,
    mode: ImportRepoMode,
    app_handle: &tauri::AppHandle,
) -> Result<(), String> {
    use tauri::Emitter;
    import_repo_filesystem(workspace, source_repo, mode, &|msg| {
        let _ = app_handle.emit("import-progress", msg);
    })
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

    initialize_workspace_db(&workspace).await?;

    if !project_marker_path.exists() {
        write_project_marker(
            &project_marker_path,
            &workspace,
            &root_path,
            &worktrees_path,
            &state_db_path,
        )?;
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
        let clone_auth = git_clone_auth_context()?;

        let mut clone_command = git_command(
            GitAction::Clone,
            &["clone", "--progress", &url, &root_path_string],
        );
        clone_command.stdout(Stdio::piped());
        clone_command.stderr(Stdio::piped());

        if let Some(auth) = clone_auth.as_ref() {
            clone_command.envs(auth.envs.iter().map(|(key, value)| (key, value)));
        }

        let mut child = clone_command
            .spawn()
            .map_err(|e| format!("Failed to run git clone: {e}"))?;

        const MAX_STDERR_LINES: usize = 100;
        let mut stderr_lines: VecDeque<String> = VecDeque::with_capacity(MAX_STDERR_LINES);
        let mut latest_error_line: Option<String> = None;
        if let Some(stderr) = child.stderr.take() {
            let reader = BufReader::new(stderr);
            let mut line_buf = String::new();
            for byte in reader.bytes() {
                match byte {
                    Ok(b'\r') | Ok(b'\n') => {
                        let trimmed = line_buf.trim().to_string();
                        if !trimmed.is_empty() {
                            let _ = app_handle.emit("clone-progress", &trimmed);
                            if is_git_error_line(&trimmed) {
                                latest_error_line = Some(trimmed.clone());
                            }
                            if stderr_lines.len() == MAX_STDERR_LINES {
                                stderr_lines.pop_front();
                            }
                            stderr_lines.push_back(trimmed);
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
                if is_git_error_line(&trimmed) {
                    latest_error_line = Some(trimmed.clone());
                }
                if stderr_lines.len() == MAX_STDERR_LINES {
                    stderr_lines.pop_front();
                }
                stderr_lines.push_back(trimmed);
            }
        }

        let status = child
            .wait()
            .map_err(|e| format!("Failed to wait for git clone: {e}"))?;

        if !status.success() {
            let _ = app_handle.emit("clone-progress", "Clone failed");
            // Find the most relevant error line from git's stderr output.
            // Git prefixes errors with "fatal:" or "error:"; prefer those.
            let error_detail = latest_error_line.or_else(|| stderr_lines.back().cloned());
            let msg = match error_detail {
                Some(detail) => {
                    // Provide a friendlier hint for authentication failures.
                    if detail.to_lowercase().contains("authentication")
                        || detail.to_lowercase().contains("could not read username")
                        || detail.to_lowercase().contains("repository not found")
                    {
                        format!(
                            "Authentication failed — check your credentials or repo URL. ({})",
                            detail
                        )
                    } else {
                        format!("git clone failed: {}", detail)
                    }
                },
                None => "git clone failed".to_string(),
            };
            return Err(msg);
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

    crate::recent_docs::add_to_recent_documents(&workspace, &app_handle);

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
pub async fn import_git_repo_workspace(
    app_handle: tauri::AppHandle,
    workspace_path: String,
    source_repo_path: String,
) -> Result<WorkspaceInitResult, String> {
    import_git_repo_workspace_with_mode(
        app_handle,
        Some(workspace_path),
        source_repo_path,
        ImportRepoMode::Copy,
    )
    .await
}

#[tauri::command]
pub async fn import_git_repo_workspace_with_mode(
    app_handle: tauri::AppHandle,
    workspace_path: Option<String>,
    source_repo_path: String,
    mode: ImportRepoMode,
) -> Result<WorkspaceInitResult, String> {
    let source_repo = normalize_existing_path(&source_repo_path)?;
    validate_clean_git_repo(&source_repo)?;

    let workspace = match mode {
        ImportRepoMode::InPlace => source_repo.clone(),
        ImportRepoMode::Move | ImportRepoMode::Copy => {
            let Some(path) = workspace_path
                .as_deref()
                .map(str::trim)
                .filter(|p| !p.is_empty())
            else {
                return Err("Workspace path is required for move/copy import modes".to_string());
            };
            normalize_or_create_dir(path)?
        },
    };

    if matches!(mode, ImportRepoMode::Move | ImportRepoMode::Copy) && workspace == source_repo {
        return Err(
            "Workspace path must differ from repository path for move/copy modes".to_string(),
        );
    }

    let root_path = workspace.join("root");
    let worktrees_path = workspace.join("worktrees");
    let metadata_path = workspace.join(".sproutgit");
    let state_db_path = metadata_path.join("state.db");

    import_repo_with_mode(&workspace, &source_repo, mode, &app_handle)?;

    initialize_workspace_db(&workspace).await?;

    let result = finalize_workspace(
        &workspace,
        &root_path,
        &worktrees_path,
        &metadata_path,
        &state_db_path,
        matches!(mode, ImportRepoMode::Copy),
    )?;

    crate::recent_docs::add_to_recent_documents(&workspace, &app_handle);

    Ok(result)
}

#[tauri::command]
pub async fn inspect_sproutgit_workspace(
    app_handle: tauri::AppHandle,
    workspace_path: String,
) -> Result<WorkspaceStatus, String> {
    let workspace = normalize_existing_path(&workspace_path)?;

    let root_path = workspace.join("root");
    let worktrees_path = workspace.join("worktrees");
    let metadata_path = workspace.join(".sproutgit");
    let state_db_path = metadata_path.join("state.db");
    let project_marker_path = metadata_path.join("project.json");

    let root_exists = root_path.exists();
    let worktrees_exists = worktrees_path.exists();
    let metadata_exists = metadata_path.exists();
    let project_marker_exists = project_marker_path.exists();
    let layout_exists = root_exists && worktrees_exists && metadata_exists;

    if layout_exists {
        // Backfill state DB for projects created before workspace DB became required.
        if !state_db_path.exists() {
            initialize_workspace_db(&workspace).await?;
        }

        // Backfill marker for legacy projects while preserving existing paths.
        if !project_marker_exists {
            write_project_marker(
                &project_marker_path,
                &workspace,
                &root_path,
                &worktrees_path,
                &state_db_path,
            )?;
        }
    }

    let status = WorkspaceStatus {
        workspace_path: workspace.to_string_lossy().to_string(),
        root_path: root_path.to_string_lossy().to_string(),
        worktrees_path: worktrees_path.to_string_lossy().to_string(),
        metadata_path: metadata_path.to_string_lossy().to_string(),
        state_db_path: state_db_path.to_string_lossy().to_string(),
        is_sproutgit_project: project_marker_path.exists() || layout_exists,
        root_exists,
        worktrees_exists,
        metadata_exists,
        state_db_exists: state_db_path.exists(),
    };

    if status.is_sproutgit_project {
        crate::recent_docs::add_to_recent_documents(&workspace, &app_handle);
    }

    Ok(status)
}

// ── Tests ──

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs;
    use std::io;
    use tempfile::TempDir;

    type TestResult = Result<(), Box<dyn std::error::Error>>;

    /// Create a temp dir populated with a flat set of named files.
    fn make_repo(files: &[&str]) -> Result<TempDir, Box<dyn std::error::Error>> {
        let dir = tempfile::tempdir()?;
        for name in files {
            // Support nested paths like "src/main.rs"
            let path = dir.path().join(name);
            if let Some(parent) = path.parent() {
                fs::create_dir_all(parent)?;
            }
            fs::write(&path, name.as_bytes())?;
        }
        Ok(dir)
    }

    fn import_ok(
        workspace: &std::path::Path,
        source_repo: &std::path::Path,
        mode: ImportRepoMode,
    ) -> TestResult {
        import_repo_filesystem(workspace, source_repo, mode, &no_progress)
            .map_err(io::Error::other)?;
        Ok(())
    }

    fn no_progress(_: &str) {}

    // ── count_files_recursive ──────────────────────────────────────────────

    #[test]
    fn count_files_empty_dir() -> TestResult {
        let dir = tempfile::tempdir()?;
        assert_eq!(count_files_recursive(dir.path())?, 0);
        Ok(())
    }

    #[test]
    fn count_files_flat() -> TestResult {
        let repo = make_repo(&["a.txt", "b.txt", "c.txt"])?;
        assert_eq!(count_files_recursive(repo.path())?, 3);
        Ok(())
    }

    #[test]
    fn count_files_nested() -> TestResult {
        let repo = make_repo(&["a.txt", "src/main.rs", "src/lib.rs", "docs/readme.md"])?;
        assert_eq!(count_files_recursive(repo.path())?, 4);
        Ok(())
    }

    // ── InPlace: collision detection ───────────────────────────────────────

    #[test]
    fn inplace_rejects_reserved_name_root() -> TestResult {
        let repo = make_repo(&["main.rs"])?;
        fs::create_dir(repo.path().join("root"))?;

        let err = import_repo_filesystem(
            repo.path(),
            repo.path(),
            ImportRepoMode::InPlace,
            &no_progress,
        )
        .err()
        .ok_or_else(|| io::Error::other("expected import to fail"))?;
        assert!(err.contains("root"), "expected 'root' in: {err}");
        assert!(
            err.contains("reserved workspace path"),
            "expected error kind in: {err}"
        );
        Ok(())
    }

    #[test]
    fn inplace_rejects_reserved_name_worktrees() -> TestResult {
        let repo = make_repo(&["main.rs"])?;
        fs::create_dir(repo.path().join("worktrees"))?;

        let err = import_repo_filesystem(
            repo.path(),
            repo.path(),
            ImportRepoMode::InPlace,
            &no_progress,
        )
        .err()
        .ok_or_else(|| io::Error::other("expected import to fail"))?;
        assert!(err.contains("worktrees"), "expected 'worktrees' in: {err}");
        Ok(())
    }

    #[test]
    fn inplace_rejects_reserved_name_sproutgit_dir() -> TestResult {
        let repo = make_repo(&["main.rs"])?;
        fs::create_dir(repo.path().join(".sproutgit"))?;

        let err = import_repo_filesystem(
            repo.path(),
            repo.path(),
            ImportRepoMode::InPlace,
            &no_progress,
        )
        .err()
        .ok_or_else(|| io::Error::other("expected import to fail"))?;
        assert!(
            err.contains(".sproutgit"),
            "expected '.sproutgit' in: {err}"
        );
        Ok(())
    }

    #[test]
    fn inplace_rejects_multiple_reserved_names() -> TestResult {
        let repo = make_repo(&["main.rs"])?;
        fs::create_dir(repo.path().join("root"))?;
        fs::create_dir(repo.path().join("worktrees"))?;

        let err = import_repo_filesystem(
            repo.path(),
            repo.path(),
            ImportRepoMode::InPlace,
            &no_progress,
        )
        .err()
        .ok_or_else(|| io::Error::other("expected import to fail"))?;
        assert!(err.contains("root"), "expected 'root' in: {err}");
        assert!(err.contains("worktrees"), "expected 'worktrees' in: {err}");
        Ok(())
    }

    // ── InPlace: filesystem outcome ────────────────────────────────────────

    #[test]
    fn inplace_moves_all_files_into_root() -> TestResult {
        let repo = make_repo(&["main.rs", "Cargo.toml"])?;
        let repo_path = repo.path().to_path_buf();

        import_ok(&repo_path, &repo_path, ImportRepoMode::InPlace)?;

        // Files land in root/
        assert!(
            repo_path.join("root/main.rs").exists(),
            "main.rs should be in root/"
        );
        assert!(
            repo_path.join("root/Cargo.toml").exists(),
            "Cargo.toml should be in root/"
        );
        // Workspace dirs created
        assert!(repo_path.join("worktrees").is_dir());
        assert!(repo_path.join(".sproutgit").is_dir());
        // Original paths gone
        assert!(!repo_path.join("main.rs").exists());
        assert!(!repo_path.join("Cargo.toml").exists());
        Ok(())
    }

    #[test]
    fn inplace_preserves_nested_structure_inside_root() -> TestResult {
        let repo = make_repo(&["src/main.rs", "src/lib.rs", "README.md"])?;
        let repo_path = repo.path().to_path_buf();

        import_ok(&repo_path, &repo_path, ImportRepoMode::InPlace)?;

        assert!(repo_path.join("root/src/main.rs").exists());
        assert!(repo_path.join("root/src/lib.rs").exists());
        assert!(repo_path.join("root/README.md").exists());
        Ok(())
    }

    #[test]
    fn inplace_empty_repo_still_creates_workspace_dirs() -> TestResult {
        let repo = make_repo(&[])?;
        let repo_path = repo.path().to_path_buf();

        import_ok(&repo_path, &repo_path, ImportRepoMode::InPlace)?;

        assert!(repo_path.join("root").is_dir());
        assert!(repo_path.join("worktrees").is_dir());
        assert!(repo_path.join(".sproutgit").is_dir());
        Ok(())
    }

    #[test]
    fn inplace_does_not_create_dirs_before_collision_check() -> TestResult {
        // If directories were eagerly created, the collision check would always
        // find 'root', 'worktrees', '.sproutgit' and fail for clean repos too.
        let repo = make_repo(&["main.rs"])?;
        let repo_path = repo.path().to_path_buf();

        // Should succeed — no pre-existing reserved names
        import_ok(&repo_path, &repo_path, ImportRepoMode::InPlace)?;
        Ok(())
    }

    // ── Copy: filesystem outcome ───────────────────────────────────────────

    #[test]
    fn copy_creates_files_in_workspace_root() -> TestResult {
        let source = make_repo(&["main.rs", "Cargo.toml"])?;
        let workspace = tempfile::tempdir()?;

        import_ok(workspace.path(), source.path(), ImportRepoMode::Copy)?;

        assert!(workspace.path().join("root/main.rs").exists());
        assert!(workspace.path().join("root/Cargo.toml").exists());
        assert!(workspace.path().join("worktrees").is_dir());
        assert!(workspace.path().join(".sproutgit").is_dir());
        Ok(())
    }

    #[test]
    fn copy_preserves_source_repo() -> TestResult {
        let source = make_repo(&["main.rs"])?;
        let workspace = tempfile::tempdir()?;

        import_ok(workspace.path(), source.path(), ImportRepoMode::Copy)?;

        // Source must be untouched
        assert!(
            source.path().join("main.rs").exists(),
            "source file should still exist after copy"
        );
        Ok(())
    }

    #[test]
    fn copy_preserves_nested_directory_structure() -> TestResult {
        let source = make_repo(&["src/main.rs", "src/lib.rs", "docs/readme.md"])?;
        let workspace = tempfile::tempdir()?;

        import_ok(workspace.path(), source.path(), ImportRepoMode::Copy)?;

        assert!(workspace.path().join("root/src/main.rs").exists());
        assert!(workspace.path().join("root/src/lib.rs").exists());
        assert!(workspace.path().join("root/docs/readme.md").exists());
        Ok(())
    }

    #[test]
    fn copy_file_contents_are_identical() -> TestResult {
        let source = make_repo(&["hello.txt"])?;
        fs::write(source.path().join("hello.txt"), b"hello world")?;
        let workspace = tempfile::tempdir()?;

        import_ok(workspace.path(), source.path(), ImportRepoMode::Copy)?;

        let contents = fs::read(workspace.path().join("root/hello.txt"))?;
        assert_eq!(contents, b"hello world");
        Ok(())
    }

    #[test]
    fn copy_reports_progress_messages() -> TestResult {
        let source = make_repo(&["a.txt", "b.txt"])?;
        let workspace = tempfile::tempdir()?;
        let messages: std::cell::RefCell<Vec<String>> = std::cell::RefCell::new(Vec::new());

        import_repo_filesystem(
            workspace.path(),
            source.path(),
            ImportRepoMode::Copy,
            &|msg| messages.borrow_mut().push(msg.to_string()),
        )
        .map_err(io::Error::other)?;

        let messages = messages.into_inner();
        assert!(
            !messages.is_empty(),
            "expected at least one progress message"
        );
        assert!(
            messages.iter().any(|m| m.contains("Counting")),
            "expected counting message"
        );
        assert!(
            messages.iter().any(|m| m.contains('%')),
            "expected percentage message"
        );
        Ok(())
    }

    // ── Move: filesystem outcome ───────────────────────────────────────────

    #[test]
    fn move_files_land_in_workspace_root() -> TestResult {
        let source = make_repo(&["main.rs", "Cargo.toml"])?;
        let source_path = source.path().to_path_buf();
        let workspace = tempfile::tempdir()?;

        import_ok(workspace.path(), &source_path, ImportRepoMode::Move)?;

        assert!(workspace.path().join("root/main.rs").exists());
        assert!(workspace.path().join("root/Cargo.toml").exists());
        assert!(workspace.path().join("worktrees").is_dir());
        assert!(workspace.path().join(".sproutgit").is_dir());
        Ok(())
    }

    #[test]
    fn move_source_is_removed_after_same_filesystem_move() -> TestResult {
        let source = make_repo(&["main.rs"])?;
        let source_path = source.path().to_path_buf();
        let workspace = tempfile::tempdir()?;

        import_ok(workspace.path(), &source_path, ImportRepoMode::Move)?;

        // After a successful move the source directory should no longer exist.
        assert!(!source_path.exists(), "source should be removed after move");
        Ok(())
    }

    // ── count_files_recursive handles missing dir deterministically ───────

    #[test]
    fn count_files_nonexistent_dir_returns_error() -> TestResult {
        let tempdir = tempfile::tempdir()?;
        let path = tempdir.path().join("does-not-exist");
        let err = count_files_recursive(&path).err().ok_or_else(|| {
            io::Error::other("count_files_recursive should fail for nonexistent directories")
        })?;
        assert!(err.contains("Failed to read directory while counting files"));
        Ok(())
    }
}
