use serde::Serialize;
use std::path::{Path, PathBuf};

use crate::git::helpers::{
    ensure_directory, ensure_git_success, git_command, normalize_existing_path,
    normalize_or_create_dir, path_to_frontend, run_git, slugify_for_path,
    validate_non_option_value, GitAction,
};
use crate::hooks::execute_workspace_hooks_for_trigger;

// ── Structs ──

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct GitInfo {
    pub installed: bool,
    pub version: Option<String>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct WorktreeInfo {
    pub path: String,
    pub head: Option<String>,
    pub branch: Option<String>,
    pub detached: bool,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct WorktreeListResult {
    pub repo_path: String,
    pub worktrees: Vec<WorktreeInfo>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RefInfo {
    pub name: String,
    pub full_name: String,
    pub kind: String,
    pub target: String,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RefsResult {
    pub repo_path: String,
    pub refs: Vec<RefInfo>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CommitGraphResult {
    pub repo_path: String,
    pub commits: Vec<CommitEntry>,
}

#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct CommitEntry {
    pub hash: String,
    pub short_hash: String,
    pub parents: Vec<String>,
    pub author_name: String,
    pub author_email: String,
    pub author_date: String,
    pub subject: String,
    pub refs: Vec<String>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CreateWorktreeResult {
    pub worktree_path: String,
    pub branch: String,
    pub from_ref: String,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CheckoutResult {
    pub worktree_path: String,
    pub previous_branch: Option<String>,
    pub new_branch: String,
    pub stashed: bool,
}

/// Clamp a graph page size to [20, 2000], defaulting to 2000.
pub(crate) fn clamp_graph_limit(limit: Option<usize>) -> usize {
    limit.unwrap_or(2000).clamp(20, 2000)
}

/// Clamp a skip value to at most 200,000.
pub(crate) fn clamp_graph_skip(skip: Option<usize>) -> Option<usize> {
    const MAX_GRAPH_SKIP: usize = 200_000;
    skip.map(|s| s.min(MAX_GRAPH_SKIP))
}

/// Parse a single record-separator-delimited commit line into a CommitEntry.
pub(crate) fn parse_commit_line(line: &str, sep: &str) -> Option<CommitEntry> {
    let parts: Vec<&str> = line.split(sep).collect();
    if parts.len() < 8 {
        return None;
    }

    let refs_list: Vec<String> = if parts[7].is_empty() {
        vec![]
    } else {
        parts[7].split(", ").map(|r| r.trim().to_string()).collect()
    };

    Some(CommitEntry {
        hash: parts[0].to_string(),
        short_hash: parts[1].to_string(),
        parents: if parts[2].is_empty() {
            vec![]
        } else {
            parts[2].split(' ').map(|p| p.to_string()).collect()
        },
        author_name: parts[3].to_string(),
        author_email: parts[4].to_string(),
        author_date: parts[5].to_string(),
        subject: parts[6].to_string(),
        refs: refs_list,
    })
}

fn workspace_from_root_repo(root_repo: &Path) -> Option<PathBuf> {
    let workspace = root_repo.parent()?.to_path_buf();
    let db = workspace.join(".sproutgit").join("state.db");
    if db.exists() {
        Some(workspace)
    } else {
        None
    }
}

fn workspace_from_worktree_path(worktree_path: &Path) -> Option<PathBuf> {
    for ancestor in worktree_path.ancestors() {
        let db = ancestor.join(".sproutgit").join("state.db");
        if db.exists() {
            return Some(ancestor.to_path_buf());
        }
    }

    None
}

// ── Commands ──

#[tauri::command]
pub async fn git_info() -> GitInfo {
    match git_command(GitAction::GitInfo, &["--version"]).output() {
        Ok(output) if output.status.success() => {
            let version = String::from_utf8_lossy(&output.stdout).trim().to_string();
            GitInfo {
                installed: true,
                version: Some(version),
            }
        },
        _ => GitInfo {
            installed: false,
            version: None,
        },
    }
}

#[tauri::command]
pub async fn list_worktrees(repo_path: String) -> Result<WorktreeListResult, String> {
    let canonical = normalize_existing_path(&repo_path)?;

    let canonical_string = canonical.to_string_lossy().to_string();
    let output = git_command(
        GitAction::WorktreeList,
        &["-C", &canonical_string, "worktree", "list", "--porcelain"],
    )
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
                path: path_to_frontend(Path::new(rest)),
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
        repo_path: path_to_frontend(&canonical),
        worktrees,
    })
}

#[tauri::command]
pub async fn list_refs(repo_path: String) -> Result<RefsResult, String> {
    let canonical = normalize_existing_path(&repo_path)?;

    let output = run_git(
        GitAction::ListRefs,
        &[
            "-C",
            &canonical.to_string_lossy(),
            "for-each-ref",
            "--sort=-committerdate",
            "--format=%(refname)|%(refname:short)|%(objectname)",
            "refs/heads",
            "refs/tags",
        ],
    )?;

    let output = ensure_git_success(output, "Failed to list refs")?;
    let stdout = String::from_utf8_lossy(&output.stdout);

    let refs = stdout
        .lines()
        .filter_map(|line| {
            let mut parts = line.split('|');
            let full_name = parts.next()?.to_string();
            let short_name = parts.next()?.to_string();
            let target = parts.next()?.to_string();

            let kind = if full_name.starts_with("refs/heads/") {
                "branch"
            } else {
                "tag"
            };

            Some(RefInfo {
                name: short_name,
                full_name,
                kind: kind.to_string(),
                target,
            })
        })
        .collect();

    Ok(RefsResult {
        repo_path: path_to_frontend(&canonical),
        refs,
    })
}

#[tauri::command]
pub async fn count_commits(repo_path: String) -> Result<u64, String> {
    let canonical = normalize_existing_path(&repo_path)?;
    let output = run_git(
        GitAction::CountCommits,
        &[
            "-C",
            &canonical.to_string_lossy(),
            "rev-list",
            "--count",
            "--all",
        ],
    )?;
    let output = ensure_git_success(output, "Failed to count commits")?;
    let stdout = String::from_utf8_lossy(&output.stdout);
    stdout
        .trim()
        .parse::<u64>()
        .map_err(|_| "Failed to parse commit count".to_string())
}

#[tauri::command]
pub async fn get_commit_graph(
    repo_path: String,
    limit: Option<usize>,
    skip: Option<usize>,
) -> Result<CommitGraphResult, String> {
    let canonical = normalize_existing_path(&repo_path)?;

    let sep = "\x1e";
    let format_str = ["%H", "%h", "%P", "%an", "%ae", "%ar", "%s", "%D"].join(sep);

    let mut args = vec![
        "-C".to_string(),
        canonical.to_string_lossy().to_string(),
        "log".to_string(),
        "--all".to_string(),
        "--author-date-order".to_string(),
        format!("--format={format_str}"),
    ];

    let max = clamp_graph_limit(limit).to_string();
    args.push("-n".to_string());
    args.push(max);

    if let Some(safe_skip) = clamp_graph_skip(skip) {
        args.push("--skip".to_string());
        args.push(safe_skip.to_string());
    }

    let arg_refs: Vec<&str> = args.iter().map(String::as_str).collect();

    let output = run_git(GitAction::CommitGraph, &arg_refs)?;

    let output = ensure_git_success(output, "Failed to read commit history")?;
    let stdout = String::from_utf8_lossy(&output.stdout);

    let commits: Vec<CommitEntry> = stdout
        .lines()
        .filter(|line| !line.is_empty())
        .filter_map(|line| parse_commit_line(line, sep))
        .collect();

    Ok(CommitGraphResult {
        repo_path: path_to_frontend(&canonical),
        commits,
    })
}

#[tauri::command]
pub async fn create_managed_worktree(
    app_handle: tauri::AppHandle,
    root_repo_path: String,
    managed_worktrees_path: String,
    from_ref: String,
    new_branch: String,
    initiating_worktree_path: Option<String>,
) -> Result<CreateWorktreeResult, String> {
    let root_repo = normalize_existing_path(&root_repo_path)?;
    let worktrees_dir = normalize_or_create_dir(&managed_worktrees_path)?;
    let initiating_worktree = crate::hooks::normalize_optional_existing_dir(
        initiating_worktree_path.as_deref(),
        "Initiating worktree path",
    )?;

    let branch = new_branch.trim();
    let branch = validate_non_option_value(branch, "New branch")?;

    let ref_name = from_ref.trim();
    let ref_name = validate_non_option_value(ref_name, "Source ref")?;

    let slug = slugify_for_path(&branch);
    if slug.is_empty() {
        return Err("Branch name must include letters or numbers".to_string());
    }

    let target_worktree = worktrees_dir.join(slug);
    if target_worktree.exists() {
        return Err(format!(
            "Managed worktree path already exists: {}",
            target_worktree.display()
        ));
    }

    if let Some(workspace_path) = workspace_from_root_repo(&root_repo) {
        let before_summary = execute_workspace_hooks_for_trigger(
            crate::hooks::HookExecutionContext {
                workspace_path: workspace_path.clone(),
                trigger_worktree_path: Some(target_worktree.clone()),
                initiating_worktree_path: initiating_worktree.clone(),
            },
            "before_worktree_create",
            Some(&app_handle),
        )
        .await?;

        if before_summary.had_critical_failure {
            return Err(format!(
                "Worktree creation blocked by critical hook failure(s): {}",
                before_summary.failed_critical_hooks.join(", ")
            ));
        }
    }

    // Hooks or external processes can remove the managed worktrees directory
    // between validation and git invocation. Ensure it exists at the point of use.
    ensure_directory(&worktrees_dir)?;

    let output = run_git(
        GitAction::CreateManagedWorktree,
        &[
            "-C",
            &root_repo.to_string_lossy(),
            "worktree",
            "add",
            "-b",
            &branch,
            &target_worktree.to_string_lossy(),
            &ref_name,
        ],
    )?;

    ensure_git_success(output, "Failed to create managed worktree")?;

    if let Some(workspace_path) = workspace_from_root_repo(&root_repo) {
        let _ = execute_workspace_hooks_for_trigger(
            crate::hooks::HookExecutionContext {
                workspace_path: workspace_path.clone(),
                trigger_worktree_path: Some(target_worktree.clone()),
                initiating_worktree_path: initiating_worktree.clone(),
            },
            "after_worktree_create",
            Some(&app_handle),
        )
        .await;
    }

    Ok(CreateWorktreeResult {
        worktree_path: path_to_frontend(&target_worktree),
        branch,
        from_ref: ref_name,
    })
}

#[tauri::command]
pub async fn delete_managed_worktree(
    app_handle: tauri::AppHandle,
    root_repo_path: String,
    worktree_path: String,
    delete_branch: bool,
    initiating_worktree_path: Option<String>,
) -> Result<String, String> {
    let root_repo = normalize_existing_path(&root_repo_path)?;
    let wt_path = normalize_existing_path(&worktree_path)?;
    let initiating_worktree = crate::hooks::normalize_optional_existing_dir(
        initiating_worktree_path.as_deref(),
        "Initiating worktree path",
    )?;

    if let Some(workspace_path) = workspace_from_root_repo(&root_repo) {
        let before_summary = execute_workspace_hooks_for_trigger(
            crate::hooks::HookExecutionContext {
                workspace_path: workspace_path.clone(),
                trigger_worktree_path: Some(wt_path.clone()),
                initiating_worktree_path: initiating_worktree.clone(),
            },
            "before_worktree_remove",
            Some(&app_handle),
        )
        .await?;

        if before_summary.had_critical_failure {
            return Err(format!(
                "Worktree removal blocked by critical hook failure(s): {}",
                before_summary.failed_critical_hooks.join(", ")
            ));
        }
    }

    let output = run_git(
        GitAction::DeleteManagedWorktree,
        &[
            "-C",
            &root_repo.to_string_lossy(),
            "worktree",
            "remove",
            &wt_path.to_string_lossy(),
            "--force",
        ],
    )?;
    ensure_git_success(output, "Failed to remove worktree")?;

    if delete_branch {
        let output = run_git(
            GitAction::PruneWorktrees,
            &["-C", &root_repo.to_string_lossy(), "worktree", "prune"],
        )?;
        let _ = ensure_git_success(output, "Failed to prune worktrees");
    }

    if let Some(workspace_path) = workspace_from_root_repo(&root_repo) {
        let _ = execute_workspace_hooks_for_trigger(
            crate::hooks::HookExecutionContext {
                workspace_path: workspace_path.clone(),
                trigger_worktree_path: Some(wt_path.clone()),
                initiating_worktree_path: initiating_worktree.clone(),
            },
            "after_worktree_remove",
            Some(&app_handle),
        )
        .await;
    }

    Ok(path_to_frontend(&wt_path))
}

#[tauri::command]
pub async fn checkout_worktree(
    app_handle: tauri::AppHandle,
    worktree_path: String,
    target_ref: String,
    auto_stash: bool,
) -> Result<CheckoutResult, String> {
    let wt_path = normalize_existing_path(&worktree_path)?;
    let wt_str = wt_path.to_string_lossy();
    let target = validate_non_option_value(target_ref.trim(), "Target ref")?;
    let workspace_for_hooks = workspace_from_worktree_path(&wt_path);

    if let Some(workspace_path) = workspace_for_hooks.as_ref() {
        let before_summary = execute_workspace_hooks_for_trigger(
            crate::hooks::HookExecutionContext {
                workspace_path: workspace_path.clone(),
                trigger_worktree_path: Some(wt_path.clone()),
                initiating_worktree_path: Some(wt_path.clone()),
            },
            "before_worktree_switch",
            Some(&app_handle),
        )
        .await?;

        if before_summary.had_critical_failure {
            return Err(format!(
                "Worktree switch blocked by critical hook failure(s): {}",
                before_summary.failed_critical_hooks.join(", ")
            ));
        }
    }

    // Get current branch before checkout
    let current_output = run_git(
        GitAction::RevParse,
        &["-C", &wt_str, "rev-parse", "--abbrev-ref", "HEAD"],
    )?;
    let previous_branch = if current_output.status.success() {
        let b = String::from_utf8_lossy(&current_output.stdout)
            .trim()
            .to_string();
        if b == "HEAD" {
            None
        } else {
            Some(b)
        }
    } else {
        None
    };

    // Check for uncommitted changes
    let status_output = run_git(
        GitAction::StatusPorcelain,
        &["-C", &wt_str, "status", "--porcelain"],
    )?;
    let has_changes = if status_output.status.success() {
        !String::from_utf8_lossy(&status_output.stdout)
            .trim()
            .is_empty()
    } else {
        false
    };

    let mut stashed = false;

    if has_changes {
        if !auto_stash {
            return Err(
                "Worktree has uncommitted changes. Enable auto-stash or commit/discard them first."
                    .to_string(),
            );
        }
        let stash_output = run_git(
            GitAction::StashPush,
            &["-C", &wt_str, "stash", "push", "-m", "sproutgit-auto-stash"],
        )?;
        ensure_git_success(stash_output, "Failed to stash changes")?;
        stashed = true;
    }

    // Perform checkout
    let checkout_output = run_git(GitAction::Checkout, &["-C", &wt_str, "checkout", &target])?;
    if !checkout_output.status.success() {
        if stashed {
            let _ = run_git(GitAction::StashPop, &["-C", &wt_str, "stash", "pop"]);
        }
        let stderr = String::from_utf8_lossy(&checkout_output.stderr)
            .trim()
            .to_string();
        return Err(if stderr.is_empty() {
            "Checkout failed".to_string()
        } else {
            stderr
        });
    }

    // Pop stash back on the new branch
    if stashed {
        let pop_output = run_git(GitAction::StashPop, &["-C", &wt_str, "stash", "pop"])?;
        if !pop_output.status.success() {
            if let Some(workspace_path) = workspace_for_hooks.as_ref() {
                let _ = execute_workspace_hooks_for_trigger(
                    crate::hooks::HookExecutionContext {
                        workspace_path: workspace_path.clone(),
                        trigger_worktree_path: Some(wt_path.clone()),
                        initiating_worktree_path: Some(wt_path.clone()),
                    },
                    "after_worktree_switch",
                    Some(&app_handle),
                )
                .await;
            }

            return Ok(CheckoutResult {
                worktree_path: wt_str.to_string(),
                previous_branch,
                new_branch: target,
                stashed: true,
            });
        }
    }

    if let Some(workspace_path) = workspace_for_hooks.as_ref() {
        let _ = execute_workspace_hooks_for_trigger(
            crate::hooks::HookExecutionContext {
                workspace_path: workspace_path.clone(),
                trigger_worktree_path: Some(wt_path.clone()),
                initiating_worktree_path: Some(wt_path.clone()),
            },
            "after_worktree_switch",
            Some(&app_handle),
        )
        .await;
    }

    Ok(CheckoutResult {
        worktree_path: wt_str.to_string(),
        previous_branch,
        new_branch: target,
        stashed,
    })
}

#[tauri::command]
pub async fn reset_worktree_branch(
    worktree_path: String,
    target_ref: String,
    mode: String,
) -> Result<String, String> {
    let wt_path = normalize_existing_path(&worktree_path)?;
    let wt_str = wt_path.to_string_lossy();
    let target = validate_non_option_value(target_ref.trim(), "Target ref")?;

    let reset_mode = match mode.as_str() {
        "soft" => "--soft",
        "mixed" => "--mixed",
        "hard" => "--hard",
        _ => {
            return Err(format!(
                "Invalid reset mode: {mode}. Use soft, mixed, or hard."
            ))
        },
    };

    let output = run_git(
        GitAction::Reset,
        &["-C", &wt_str, "reset", reset_mode, &target],
    )?;
    ensure_git_success(output, "Failed to reset branch")?;

    Ok(format!("Reset to {target} ({mode})"))
}

// ── Tier 2: Semantic High-Level Operations ──

/// Create a feature worktree from a source ref with explicit branching.
/// Convenience wrapper over create_managed_worktree for clarity.
#[allow(dead_code)]
pub async fn create_feature_worktree(
    app_handle: tauri::AppHandle,
    root_path: String,
    worktrees_path: String,
    source_ref: String,
    feature_name: String,
) -> Result<CreateWorktreeResult, String> {
    // Validate inputs
    let _root = normalize_existing_path(&root_path)?;
    let _worktrees = normalize_existing_path(&worktrees_path)?;
    let source = validate_non_option_value(&source_ref, "Source ref")?;
    let feature = validate_non_option_value(&feature_name, "Feature name")?;

    // Use existing create_managed_worktree under the hood
    create_managed_worktree(
        app_handle,
        root_path,
        worktrees_path,
        source,
        feature,
        None,
    )
    .await
}

/// Checkout a worktree to a target ref with automatic stash.
/// Semantic alias for clarity (what we're actually doing: switching branches).
#[allow(dead_code)]
pub async fn switch_worktree_branch(
    app_handle: tauri::AppHandle,
    worktree_path: String,
    target_ref: String,
    auto_stash: bool,
) -> Result<CheckoutResult, String> {
    checkout_worktree(app_handle, worktree_path, target_ref, auto_stash).await
}

/// Cleanup and reset a worktree to a clean state.
/// Hard-resets the worktree and cleans untracked files.
#[allow(dead_code)]
pub async fn reset_worktree_to_ref(
    worktree_path: String,
    target_ref: String,
) -> Result<String, String> {
    // First hard reset to the target
    reset_worktree_branch(
        worktree_path.clone(),
        target_ref.clone(),
        "hard".to_string(),
    )
    .await?;

    // Then clean untracked files
    let wt_path = normalize_existing_path(&worktree_path)?;
    let wt_str = wt_path.to_string_lossy();
    let clean_output = run_git(GitAction::Reset, &["-C", &wt_str, "clean", "-fd"])?;
    ensure_git_success(clean_output, "Failed to clean worktree")?;

    Ok(format!("Worktree reset to {target_ref} and cleaned"))
}

#[cfg(test)]
mod tests {
    use super::{clamp_graph_limit, clamp_graph_skip, parse_commit_line};

    const SEP: &str = "\x1e";

    fn make_line(fields: &[&str]) -> String {
        fields.join(SEP)
    }

    // ── clamp_graph_limit ──

    #[test]
    fn limit_defaults_to_2000() {
        assert_eq!(clamp_graph_limit(None), 2000);
    }

    #[test]
    fn limit_clamps_below_minimum() {
        assert_eq!(clamp_graph_limit(Some(5)), 20);
        assert_eq!(clamp_graph_limit(Some(0)), 20);
    }

    #[test]
    fn limit_clamps_above_maximum() {
        assert_eq!(clamp_graph_limit(Some(5000)), 2000);
        assert_eq!(clamp_graph_limit(Some(usize::MAX)), 2000);
    }

    #[test]
    fn limit_passes_through_valid_values() {
        assert_eq!(clamp_graph_limit(Some(20)), 20);
        assert_eq!(clamp_graph_limit(Some(100)), 100);
        assert_eq!(clamp_graph_limit(Some(2000)), 2000);
    }

    // ── clamp_graph_skip ──

    #[test]
    fn skip_none_returns_none() {
        assert_eq!(clamp_graph_skip(None), None);
    }

    #[test]
    fn skip_clamps_to_page_window() {
        assert_eq!(clamp_graph_skip(Some(2_000_000)), Some(200_000));
        assert_eq!(clamp_graph_skip(Some(usize::MAX)), Some(200_000));
    }

    #[test]
    fn skip_passes_through_valid_values() {
        assert_eq!(clamp_graph_skip(Some(0)), Some(0));
        assert_eq!(clamp_graph_skip(Some(500)), Some(500));
        assert_eq!(clamp_graph_skip(Some(200_000)), Some(200_000));
    }

    // ── parse_commit_line ──

    #[test]
    fn parses_full_commit_line() {
        let line = make_line(&[
            "abc123def456",
            "abc123d",
            "parent1 parent2",
            "Alice",
            "alice@example.com",
            "2 days ago",
            "fix: resolve merge conflict",
            "HEAD -> main, origin/main",
        ]);
        let entry = parse_commit_line(&line, SEP).unwrap_or_else(|| panic!("should parse"));
        assert_eq!(entry.hash, "abc123def456");
        assert_eq!(entry.short_hash, "abc123d");
        assert_eq!(entry.parents, vec!["parent1", "parent2"]);
        assert_eq!(entry.author_name, "Alice");
        assert_eq!(entry.author_email, "alice@example.com");
        assert_eq!(entry.author_date, "2 days ago");
        assert_eq!(entry.subject, "fix: resolve merge conflict");
        assert_eq!(entry.refs, vec!["HEAD -> main", "origin/main"]);
    }

    #[test]
    fn parses_commit_with_no_parents() {
        let line = make_line(&[
            "abc123", "abc1", "", "Bob", "bob@example.com", "3 hours ago", "initial commit", "",
        ]);
        let entry = parse_commit_line(&line, SEP).unwrap_or_else(|| panic!("should parse"));
        assert!(entry.parents.is_empty());
        assert!(entry.refs.is_empty());
    }

    #[test]
    fn parses_commit_with_single_parent() {
        let line = make_line(&[
            "def456", "def4", "abc123", "Carol", "carol@x.com", "1 day ago", "feat: add login",
            "tag: v1.0",
        ]);
        let entry = parse_commit_line(&line, SEP).unwrap_or_else(|| panic!("should parse"));
        assert_eq!(entry.parents, vec!["abc123"]);
        assert_eq!(entry.refs, vec!["tag: v1.0"]);
    }

    #[test]
    fn rejects_line_with_too_few_fields() {
        let line = make_line(&["abc", "ab", "", "Name"]);
        assert!(parse_commit_line(&line, SEP).is_none());
    }

    #[test]
    fn rejects_empty_line() {
        assert!(parse_commit_line("", SEP).is_none());
    }

    #[test]
    fn handles_extra_fields_gracefully() {
        let line = make_line(&[
            "abc", "ab", "", "Name", "e@x.com", "now", "msg", "HEAD", "extra-field",
        ]);
        let entry = parse_commit_line(&line, SEP).unwrap_or_else(|| panic!("extra fields should not break parsing"));
        assert_eq!(entry.hash, "abc");
        assert_eq!(entry.refs, vec!["HEAD"]);
    }
}
