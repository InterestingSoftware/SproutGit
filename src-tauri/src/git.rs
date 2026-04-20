use serde::Serialize;

use crate::helpers::{
    ensure_git_success, git_command, normalize_existing_path, run_git, slugify_for_path,
    validate_non_option_value, GitAction,
};

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
        }
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

#[tauri::command]
pub async fn list_refs(repo_path: String) -> Result<RefsResult, String> {
    let canonical = normalize_existing_path(&repo_path)?;

    let output = run_git(GitAction::ListRefs, &[
        "-C",
        &canonical.to_string_lossy(),
        "for-each-ref",
        "--sort=-committerdate",
        "--format=%(refname)|%(refname:short)|%(objectname)",
        "refs/heads",
        "refs/tags",
    ])?;

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
        repo_path: canonical.to_string_lossy().to_string(),
        refs,
    })
}

#[tauri::command]
pub async fn get_commit_graph(repo_path: String, limit: Option<usize>) -> Result<CommitGraphResult, String> {
    let canonical = normalize_existing_path(&repo_path)?;
    let max = limit.unwrap_or(120).clamp(20, 400).to_string();

    let sep = "\x1e";
    let format_str = ["%H", "%h", "%P", "%an", "%ae", "%ar", "%s", "%D"].join(sep);

    let output = run_git(GitAction::CommitGraph, &[
        "-C",
        &canonical.to_string_lossy(),
        "log",
        "--all",
        "--topo-order",
        &format!("--format={format_str}"),
        "-n",
        &max,
    ])?;

    let output = ensure_git_success(output, "Failed to read commit history")?;
    let stdout = String::from_utf8_lossy(&output.stdout);

    let commits: Vec<CommitEntry> = stdout
        .lines()
        .filter(|line| !line.is_empty())
        .filter_map(|line| {
            let parts: Vec<&str> = line.split(sep).collect();
            if parts.len() < 8 {
                return None;
            }

            let refs_list: Vec<String> = if parts[7].is_empty() {
                vec![]
            } else {
                parts[7]
                    .split(", ")
                    .map(|r| r.trim().to_string())
                    .collect()
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
        })
        .collect();

    Ok(CommitGraphResult {
        repo_path: canonical.to_string_lossy().to_string(),
        commits,
    })
}

#[tauri::command]
pub async fn create_managed_worktree(
    root_repo_path: String,
    managed_worktrees_path: String,
    from_ref: String,
    new_branch: String,
) -> Result<CreateWorktreeResult, String> {
    let root_repo = normalize_existing_path(&root_repo_path)?;
    let worktrees_dir = normalize_existing_path(&managed_worktrees_path)?;

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

    let output = run_git(GitAction::CreateManagedWorktree, &[
        "-C",
        &root_repo.to_string_lossy(),
        "worktree",
        "add",
        "-b",
        &branch,
        &target_worktree.to_string_lossy(),
        &ref_name,
    ])?;

    ensure_git_success(output, "Failed to create managed worktree")?;

    Ok(CreateWorktreeResult {
        worktree_path: target_worktree.to_string_lossy().to_string(),
        branch,
        from_ref: ref_name,
    })
}

#[tauri::command]
pub async fn delete_managed_worktree(
    root_repo_path: String,
    worktree_path: String,
    delete_branch: bool,
) -> Result<String, String> {
    let root_repo = normalize_existing_path(&root_repo_path)?;
    let wt_path = normalize_existing_path(&worktree_path)?;

    let output = run_git(GitAction::DeleteManagedWorktree, &[
        "-C",
        &root_repo.to_string_lossy(),
        "worktree",
        "remove",
        &wt_path.to_string_lossy(),
        "--force",
    ])?;
    ensure_git_success(output, "Failed to remove worktree")?;

    if delete_branch {
        let output = run_git(GitAction::PruneWorktrees, &[
            "-C",
            &root_repo.to_string_lossy(),
            "worktree",
            "prune",
        ])?;
        let _ = ensure_git_success(output, "Failed to prune worktrees");
    }

    Ok(wt_path.to_string_lossy().to_string())
}

#[tauri::command]
pub async fn checkout_worktree(
    worktree_path: String,
    target_ref: String,
    auto_stash: bool,
) -> Result<CheckoutResult, String> {
    let wt_path = normalize_existing_path(&worktree_path)?;
    let wt_str = wt_path.to_string_lossy();
    let target = validate_non_option_value(target_ref.trim(), "Target ref")?;

    // Get current branch before checkout
    let current_output = run_git(
        GitAction::CurrentBranch,
        &["-C", &wt_str, "rev-parse", "--abbrev-ref", "HEAD"],
    )?;
    let previous_branch = if current_output.status.success() {
        let b = String::from_utf8_lossy(&current_output.stdout).trim().to_string();
        if b == "HEAD" { None } else { Some(b) }
    } else {
        None
    };

    // Check for uncommitted changes
    let status_output = run_git(GitAction::StatusPorcelain, &["-C", &wt_str, "status", "--porcelain"])?;
    let has_changes = if status_output.status.success() {
        !String::from_utf8_lossy(&status_output.stdout).trim().is_empty()
    } else {
        false
    };

    let mut stashed = false;

    if has_changes {
        if !auto_stash {
            return Err("Worktree has uncommitted changes. Enable auto-stash or commit/discard them first.".to_string());
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
        let stderr = String::from_utf8_lossy(&checkout_output.stderr).trim().to_string();
        return Err(if stderr.is_empty() { "Checkout failed".to_string() } else { stderr });
    }

    // Pop stash back on the new branch
    if stashed {
        let pop_output = run_git(GitAction::StashPop, &["-C", &wt_str, "stash", "pop"])?;
        if !pop_output.status.success() {
            return Ok(CheckoutResult {
                worktree_path: wt_str.to_string(),
                previous_branch,
                new_branch: target,
                stashed: true,
            });
        }
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
        _ => return Err(format!("Invalid reset mode: {mode}. Use soft, mixed, or hard.")),
    };

    let output = run_git(GitAction::Reset, &["-C", &wt_str, "reset", reset_mode, &target])?;
    ensure_git_success(output, "Failed to reset branch")?;

    Ok(format!("Reset to {target} ({mode})"))
}
