use std::collections::HashSet;
use std::ffi::OsStr;
use std::path::Path;
use std::process::Stdio;
use std::sync::Mutex;
use std::time::Duration;

use notify_debouncer_mini::notify::RecursiveMode;
use notify_debouncer_mini::{new_debouncer, Debouncer};
use tauri::{AppHandle, Emitter, State};

use crate::git::helpers::{git_command, normalize_existing_path, validate_no_control_chars, GitAction};

// ── State ──

pub struct WatcherState(pub Mutex<Option<WatcherHandle>>);

pub struct WatcherHandle {
    _debouncer: Debouncer<notify_debouncer_mini::notify::RecommendedWatcher>,
}

// ── Helpers ──

/// Returns true if the path is inside a `.git` directory (index writes, pack files, etc.).
/// We skip these to avoid spurious status refreshes from git's own bookkeeping.
fn is_git_internal(path: &Path) -> bool {
    path.components().any(|c| c.as_os_str() == ".git")
}

/// Given a changed path inside a git dir and the git dir root, returns the worktree path
/// that owns the changed index file, or None if it is not a relevant git-index change.
///
/// Matches:
///   `<git_dir>/index`               → parent of git_dir (the root worktree)
///   `<git_dir>/worktrees/<name>/index` → the linked worktree path whose last
///                                        component equals `<name>`
fn match_git_index_to_worktree(
    event_path: &Path,
    git_dir: &Path,
    worktree_paths: &[String],
) -> Option<String> {
    if event_path.file_name() != Some(OsStr::new("index")) {
        return None;
    }
    let rel = event_path.strip_prefix(git_dir).ok()?;
    let comps: Vec<_> = rel.components().collect();
    match comps.as_slice() {
        // <git_dir>/index → root worktree
        [single] if single.as_os_str() == OsStr::new("index") => git_dir
            .parent()
            .and_then(|p| p.to_str())
            .map(|s| s.to_string()),
        // <git_dir>/worktrees/<name>/index → linked worktree
        [a, name, b]
            if a.as_os_str() == OsStr::new("worktrees") && b.as_os_str() == OsStr::new("index") =>
        {
            let slug = name.as_os_str();
            worktree_paths
                .iter()
                .find(|p| Path::new(p).file_name() == Some(slug))
                .cloned()
        },
        _ => None,
    }
}

/// Returns `true` if `path` matches a gitignore rule inside `worktree_path`.
/// Uses `git check-ignore -q -- <path>` (exit 0 = ignored, 1 = not ignored).
/// Falls back to `false` (treat as real change) on any error so that a git
/// failure never silently suppresses a legitimate filesystem event.
///
/// Tracks files that are *already committed* are not reported as ignored by
/// git even if a gitignore pattern would match them, so this correctly passes
/// tracked-file changes through.
fn is_gitignored_path(worktree_path: &str, path: &Path) -> bool {
    let Some(path_str) = path.to_str() else {
        return false;
    };

    git_command(
        GitAction::CheckIgnore,
        &["-C", worktree_path, "check-ignore", "-q", "--", path_str],
    )
    .stdout(Stdio::null())
    .stderr(Stdio::null())
    .stdin(Stdio::null())
    .output()
    .map(|o| o.status.code() == Some(0))
    .unwrap_or(false)
}


/// Start watching one or more worktree directories for filesystem changes.
/// Emits a `worktree-changed` Tauri event (payload: the worktree path) when any
/// non-git-internal file changes.  A 400 ms debounce prevents event flooding.
/// Calling this again replaces the previous watcher.
///
/// If `root_path` is supplied, the watcher also monitors `<root_path>/.git` for
/// changes to git index files (`index`).  This lets the UI react to staging
/// operations performed by external tools (e.g. a terminal running `git add`).
#[tauri::command]
pub async fn start_watching_worktrees(
    paths: Vec<String>,
    root_path: Option<String>,
    app: AppHandle,
    state: State<'_, WatcherState>,
) -> Result<(), String> {
    // Validate and canonicalize every worktree path up-front.
    let validated: Vec<String> = paths
        .iter()
        .map(|p| {
            let trimmed = p.trim();
            if trimmed.is_empty() {
                return Err("Worktree path cannot be empty".to_string());
            }
            validate_no_control_chars(trimmed, "Worktree path")?;
            normalize_existing_path(trimmed).map(|pb| pb.to_string_lossy().to_string())
        })
        .collect::<Result<Vec<_>, _>>()?;

    if validated.is_empty() {
        let mut guard = state
            .0
            .lock()
            .map_err(|_| "Watcher state lock poisoned".to_string())?;
        *guard = None;
        return Ok(());
    }

    // Optionally derive the .git directory to watch for staging changes.
    let validated_git_dir: Option<String> = if let Some(ref rp) = root_path {
        let trimmed = rp.trim();
        validate_no_control_chars(trimmed, "Root path")?;
        let root =
            normalize_existing_path(trimmed).map_err(|e| format!("Invalid root path: {e}"))?;
        let git_dir = root.join(".git");
        if git_dir.is_dir() {
            Some(git_dir.to_string_lossy().to_string())
        } else {
            None
        }
    } else {
        None
    };

    let paths_for_closure = validated.clone();
    let git_dir_for_closure = validated_git_dir.clone();

    let mut debouncer = new_debouncer(
        Duration::from_millis(400),
        move |result: notify_debouncer_mini::DebounceEventResult| {
            let events = match result {
                Ok(events) => events,
                Err(_) => return,
            };

            let mut affected: HashSet<String> = HashSet::new();
            for event in &events {
                let event_path = &event.path;

                // ── Git index changes (external staging) ──
                if let Some(ref git_dir) = git_dir_for_closure {
                    let git_dir_path = Path::new(git_dir);
                    if event_path.starts_with(git_dir_path) {
                        if let Some(wt) = match_git_index_to_worktree(
                            event_path,
                            git_dir_path,
                            &paths_for_closure,
                        ) {
                            // Only enqueue the path if the directory still exists;
                            // a concurrent worktree deletion could race with the
                            // index write that triggered this event.
                            if Path::new(&wt).is_dir() {
                                affected.insert(wt);
                            }
                        }
                        // Skip further processing for all .git dir events regardless.
                        continue;
                    }
                }

                // ── Normal working-tree changes ──
                if is_git_internal(event_path) {
                    continue;
                }
                for wt_path in &paths_for_closure {
                    if event_path.starts_with(wt_path.as_str()) {
                        // Skip gitignore check if the worktree is already queued
                        // (a previous event in this batch was non-ignored).
                        if affected.contains(wt_path)
                            || !is_gitignored_path(wt_path, event_path)
                        {
                            affected.insert(wt_path.clone());
                        }
                        break;
                    }
                }
            }

            for wt_path in affected {
                let _ = app.emit("worktree-changed", &wt_path);
            }
        },
    )
    .map_err(|e| format!("Failed to create file watcher: {e}"))?;

    for path in &validated {
        debouncer
            .watcher()
            .watch(Path::new(path), RecursiveMode::Recursive)
            .map_err(|e| format!("Failed to watch '{path}': {e}"))?;
    }

    // Also watch the .git directory for staging changes from external tools.
    if let Some(ref git_dir) = validated_git_dir {
        debouncer
            .watcher()
            .watch(Path::new(git_dir), RecursiveMode::Recursive)
            .map_err(|e| format!("Failed to watch git dir '{git_dir}': {e}"))?;
    }

    let mut guard = state
        .0
        .lock()
        .map_err(|_| "Watcher state lock poisoned".to_string())?;
    *guard = Some(WatcherHandle {
        _debouncer: debouncer,
    });

    Ok(())
}

/// Stop all active filesystem watchers.
#[tauri::command]
pub async fn stop_watching_worktrees(state: State<'_, WatcherState>) -> Result<(), String> {
    let mut guard = state
        .0
        .lock()
        .map_err(|_| "Watcher state lock poisoned".to_string())?;
    *guard = None;
    Ok(())
}
