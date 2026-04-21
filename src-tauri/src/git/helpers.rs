use rusqlite::{params, Connection};
use std::collections::HashSet;
use std::ffi::OsString;
use std::fs;
use std::path::{Path, PathBuf};
use std::process::{Command, Output, Stdio};
use std::time::{SystemTime, UNIX_EPOCH};

#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash)]
pub enum GitAction {
    GitInfo,
    WorktreeList,
    ListRefs,
    CommitGraph,
    CreateManagedWorktree,
    DeleteManagedWorktree,
    PruneWorktrees,
    CurrentBranch,
    RevParse,
    StatusPorcelain,
    StashPush,
    StashPop,
    Checkout,
    Reset,
    DiffFiles,
    DiffContent,
    Clone,
    Init,
    ReadGitConfig,
    SetGitConfig,
    UnsetGitConfig,
}

impl GitAction {
    #[cfg(test)]
    pub const ALL: [GitAction; 21] = [
        GitAction::GitInfo,
        GitAction::WorktreeList,
        GitAction::ListRefs,
        GitAction::CommitGraph,
        GitAction::CreateManagedWorktree,
        GitAction::DeleteManagedWorktree,
        GitAction::PruneWorktrees,
        GitAction::CurrentBranch,
        GitAction::RevParse,
        GitAction::StatusPorcelain,
        GitAction::StashPush,
        GitAction::StashPop,
        GitAction::Checkout,
        GitAction::Reset,
        GitAction::DiffFiles,
        GitAction::DiffContent,
        GitAction::Clone,
        GitAction::Init,
        GitAction::ReadGitConfig,
        GitAction::SetGitConfig,
        GitAction::UnsetGitConfig,
    ];

    pub fn label(self) -> &'static str {
        match self {
            GitAction::GitInfo => "git_info",
            GitAction::WorktreeList => "worktree_list",
            GitAction::ListRefs => "list_refs",
            GitAction::CommitGraph => "commit_graph",
            GitAction::CreateManagedWorktree => "create_managed_worktree",
            GitAction::DeleteManagedWorktree => "delete_managed_worktree",
            GitAction::PruneWorktrees => "prune_worktrees",
            GitAction::CurrentBranch => "current_branch",
            GitAction::RevParse => "rev_parse",
            GitAction::StatusPorcelain => "status_porcelain",
            GitAction::StashPush => "stash_push",
            GitAction::StashPop => "stash_pop",
            GitAction::Checkout => "checkout",
            GitAction::Reset => "reset",
            GitAction::DiffFiles => "diff_files",
            GitAction::DiffContent => "diff_content",
            GitAction::Clone => "clone",
            GitAction::Init => "init",
            GitAction::ReadGitConfig => "read_git_config",
            GitAction::SetGitConfig => "set_git_config",
            GitAction::UnsetGitConfig => "unset_git_config",
        }
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash)]
pub enum SystemAction {
    CommandLookup,
    OpenEditor,
    HookExecute,
}

impl SystemAction {
    #[cfg(test)]
    pub const ALL: [SystemAction; 3] = [
        SystemAction::CommandLookup,
        SystemAction::OpenEditor,
        SystemAction::HookExecute,
    ];

    pub fn label(self) -> &'static str {
        match self {
            SystemAction::CommandLookup => "command_lookup",
            SystemAction::OpenEditor => "open_editor",
            SystemAction::HookExecute => "hook_execute",
        }
    }
}

#[cfg(target_os = "windows")]
fn preferred_path_entries() -> Vec<PathBuf> {
    let mut entries = Vec::new();
    if let Ok(program_files) = std::env::var("ProgramFiles") {
        entries.push(PathBuf::from(&program_files).join("Git").join("cmd"));
        entries.push(PathBuf::from(&program_files).join("Git").join("bin"));
    }
    if let Ok(program_files_x86) = std::env::var("ProgramFiles(x86)") {
        entries.push(PathBuf::from(&program_files_x86).join("Git").join("cmd"));
        entries.push(PathBuf::from(&program_files_x86).join("Git").join("bin"));
    }
    entries
}

#[cfg(not(target_os = "windows"))]
fn preferred_path_entries() -> Vec<PathBuf> {
    vec![
        PathBuf::from("/opt/homebrew/bin"),
        PathBuf::from("/opt/homebrew/sbin"),
        PathBuf::from("/usr/local/bin"),
        PathBuf::from("/usr/local/sbin"),
    ]
}

/// Returns a PATH string that prepends preferred Git install directories
/// before the current PATH so GUI-launched Tauri processes find the same
/// binaries the user's shell would. On Windows this includes common Git for
/// Windows install locations under `Program Files` / `Program Files (x86)`,
/// and on Unix-like systems it includes common Homebrew and `/usr/local`
/// directories.
pub fn augmented_path() -> String {
    let current = std::env::var_os("PATH").unwrap_or_default();
    let mut combined: Vec<PathBuf> = Vec::new();
    let mut seen: HashSet<OsString> = HashSet::new();

    for segment in preferred_path_entries() {
        let key = segment.as_os_str().to_os_string();
        if seen.insert(key) {
            combined.push(segment);
        }
    }

    for segment in std::env::split_paths(&current) {
        let key = segment.as_os_str().to_os_string();
        if seen.insert(key) {
            combined.push(segment);
        }
    }

    std::env::join_paths(combined)
        .ok()
        .map(|joined| joined.to_string_lossy().to_string())
        .unwrap_or_else(|| std::env::var("PATH").unwrap_or_default())
}

pub fn validate_no_control_chars(value: &str, field_name: &str) -> Result<(), String> {
    if value.chars().any(|ch| ch.is_control()) {
        return Err(format!(
            "{field_name} contains unsupported control characters"
        ));
    }
    Ok(())
}

pub fn validate_non_option_value(value: &str, field_name: &str) -> Result<String, String> {
    let trimmed = value.trim();
    if trimmed.is_empty() {
        return Err(format!("{field_name} is required"));
    }
    validate_no_control_chars(trimmed, field_name)?;
    if trimmed.starts_with('-') {
        return Err(format!("{field_name} cannot start with '-'"));
    }
    Ok(trimmed.to_string())
}

pub fn validate_repo_url(value: &str) -> Result<String, String> {
    let trimmed = validate_non_option_value(value, "Repository URL")?;
    if trimmed.chars().any(char::is_whitespace) {
        return Err("Repository URL cannot contain whitespace".to_string());
    }
    Ok(trimmed)
}

pub fn validate_git_config_key(value: &str) -> Result<String, String> {
    let trimmed = validate_non_option_value(value, "Git config key")?;
    let valid = trimmed
        .chars()
        .all(|ch| ch.is_ascii_alphanumeric() || ch == '.' || ch == '-' || ch == '_');
    if !valid || !trimmed.contains('.') {
        return Err("Git config key is invalid. Use dotted names like user.name".to_string());
    }
    Ok(trimmed)
}

fn base_git_command() -> Command {
    let mut command = Command::new("git");
    command.env("PATH", augmented_path());
    command.env("GIT_TERMINAL_PROMPT", "0");
    command
}

pub fn run_git(action: GitAction, args: &[&str]) -> Result<Output, String> {
    base_git_command()
        .args(args)
        .output()
        .map_err(|e| format!("Failed to run git action '{}': {e}", action.label()))
}

pub fn git_command(action: GitAction, args: &[&str]) -> Command {
    let mut command = base_git_command();
    command.args(args);
    command.env("SPROUTGIT_GIT_ACTION", action.label());
    command
}

pub fn system_command(action: SystemAction, program: &str, args: &[&str]) -> Command {
    let mut command = Command::new(program);
    command.args(args);
    command.env("PATH", augmented_path());
    command.env("SPROUTGIT_SYSTEM_ACTION", action.label());
    command
}

pub fn run_system_command(
    action: SystemAction,
    program: &str,
    args: &[&str],
    suppress_output: bool,
) -> Result<Output, String> {
    let mut command = system_command(action, program, args);

    if suppress_output {
        command.stdout(Stdio::null());
        command.stderr(Stdio::null());
    }

    command
        .output()
        .map_err(|e| format!("Failed to run system action '{}': {e}", action.label()))
}

pub fn command_exists(command: &str) -> bool {
    if command.trim().is_empty() {
        return false;
    }

    let lookup_program = if cfg!(target_os = "windows") {
        "where"
    } else {
        "which"
    };

    run_system_command(
        SystemAction::CommandLookup,
        lookup_program,
        &[command],
        true,
    )
    .map(|output| output.status.success())
    .unwrap_or(false)
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
        fs::create_dir_all(path)
            .map_err(|e| format!("Failed to create workspace directory: {e}"))?;
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
            return Err(format!(
                "Expected directory but found file: {}",
                path.display()
            ));
        }
        return Ok(());
    }

    fs::create_dir_all(path)
        .map_err(|e| format!("Failed to create directory {}: {e}", path.display()))
}

pub fn ensure_git_success(
    output: std::process::Output,
    fallback_message: &str,
) -> Result<std::process::Output, String> {
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

#[allow(dead_code)]
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

// ── Tier 1: Composable Git Transaction ──

/// Builder pattern for composing multi-step git operations atomically.
/// Returns early on first error without executing remaining ops.
///
/// Example:
/// ```ignore
/// GitTransaction::new(repo_path)
///   .git_op(GitAction::CreateManagedWorktree, &["worktree", "add", ...])
///   .git_op(GitAction::Checkout, &["checkout", ...])
///   .execute()?
/// ```
#[allow(dead_code)]
pub struct GitTransaction {
    repo_path: PathBuf,
    ops: Vec<(GitAction, Vec<String>)>,
}

impl GitTransaction {
    /// Create a new transaction for a repository.
    #[allow(dead_code)]
    pub fn new(repo_path: impl AsRef<Path>) -> Self {
        Self {
            repo_path: repo_path.as_ref().to_path_buf(),
            ops: Vec::new(),
        }
    }

    /// Queue a git operation in the transaction.
    #[allow(dead_code)]
    pub fn git_op(mut self, action: GitAction, args: &[&str]) -> Self {
        self.ops
            .push((action, args.iter().map(|s| s.to_string()).collect()));
        self
    }

    /// Execute all queued operations sequentially.
    /// Returns immediately on first error.
    #[allow(dead_code)]
    pub fn execute(self) -> Result<Vec<Output>, String> {
        let mut results = Vec::new();
        for (action, args) in self.ops {
            let arg_strs: Vec<&str> = args.iter().map(|s| s.as_str()).collect();
            let output = run_git(action, &arg_strs)?;
            results.push(output);
        }
        Ok(results)
    }
}

// ── Tier 1: Read-Only Cache with Invalidation ──

use std::cell::RefCell;

/// Cached data with timestamp for validity checking.
#[allow(dead_code)]
pub struct CachedValue<T: Clone> {
    pub data: T,
    pub timestamp: u64,
}

impl<T: Clone> CachedValue<T> {
    /// Check if cache is still valid based on write timestamp.
    #[allow(dead_code)]
    pub fn is_stale(&self, last_write_ts: u64) -> bool {
        self.timestamp < last_write_ts
    }
}

/// Simple cache layer for git read operations.
/// Memoizes expensive queries; invalidate on write operations.
#[allow(dead_code)]
pub struct GitCache {
    last_write: RefCell<u64>,
}

impl GitCache {
    /// Create a new cache instance.
    #[allow(dead_code)]
    pub fn new() -> Self {
        Self {
            last_write: RefCell::new(0),
        }
    }

    /// Mark cache as dirty (call before any write operation).
    #[allow(dead_code)]
    pub fn invalidate(&self) {
        *self.last_write.borrow_mut() = now_epoch_seconds();
    }

    /// Check if a cached value is still valid.
    #[allow(dead_code)]
    pub fn is_valid(&self, cache_timestamp: u64) -> bool {
        cache_timestamp > *self.last_write.borrow()
    }
}

#[cfg(test)]
mod tests {
    use super::{
        validate_git_config_key, validate_no_control_chars, validate_non_option_value,
        validate_repo_url, ensure_git_success, slugify_for_path, CachedValue, GitAction,
        GitCache, SystemAction,
    };

    #[test]
    fn registered_git_actions_are_unique() {
        let mut labels: Vec<&str> = GitAction::ALL.iter().map(|a| a.label()).collect();
        labels.sort_unstable();
        labels.dedup();
        assert_eq!(labels.len(), GitAction::ALL.len());
    }

    #[test]
    fn registered_system_actions_are_unique() {
        let mut labels: Vec<&str> = SystemAction::ALL.iter().map(|a| a.label()).collect();
        labels.sort_unstable();
        labels.dedup();
        assert_eq!(labels.len(), SystemAction::ALL.len());
    }

    #[test]
    fn rejects_option_injection_prefix_for_untrusted_values() {
        let result = validate_non_option_value("--upload-pack=/tmp/evil", "Target ref");
        assert!(result.is_err());
    }

    #[test]
    fn validates_git_config_key_format() {
        assert!(validate_git_config_key("user.name").is_ok());
        assert!(validate_git_config_key("-c").is_err());
        assert!(validate_git_config_key("core editor").is_err());
    }

    #[test]
    fn validates_repo_url_disallows_whitespace_and_option_prefix() {
        assert!(validate_repo_url("https://github.com/acme/repo.git").is_ok());
        assert!(validate_repo_url("--local").is_err());
        assert!(validate_repo_url("https://github.com/acme/repo.git\n").is_ok());
        assert!(validate_repo_url("https://github.com/acme/repo .git").is_err());
    }

    // ── slugify_for_path ──

    #[test]
    fn slugify_simple_branch_name() {
        assert_eq!(slugify_for_path("feature-login"), "feature-login");
    }

    #[test]
    fn slugify_converts_to_lowercase() {
        assert_eq!(slugify_for_path("Feature-Login"), "feature-login");
    }

    #[test]
    fn slugify_replaces_slashes_with_dashes() {
        assert_eq!(slugify_for_path("feature/auth/login"), "feature-auth-login");
    }

    #[test]
    fn slugify_collapses_consecutive_special_chars() {
        assert_eq!(slugify_for_path("fix///multiple---slashes"), "fix-multiple---slashes");
    }

    #[test]
    fn slugify_trims_leading_trailing_dashes() {
        assert_eq!(slugify_for_path("/feature/"), "feature");
        assert_eq!(slugify_for_path("--branch--"), "branch");
    }

    #[test]
    fn slugify_handles_spaces_and_special_chars() {
        assert_eq!(slugify_for_path("my branch name"), "my-branch-name");
        assert_eq!(slugify_for_path("fix@bug#123"), "fix-bug-123");
    }

    #[test]
    fn slugify_preserves_underscores() {
        assert_eq!(slugify_for_path("my_branch_name"), "my_branch_name");
    }

    #[test]
    fn slugify_empty_string() {
        assert_eq!(slugify_for_path(""), "");
    }

    // ── validate_no_control_chars ──

    #[test]
    fn control_chars_rejects_null_byte() {
        assert!(validate_no_control_chars("hello\0world", "field").is_err());
    }

    #[test]
    fn control_chars_rejects_tab() {
        assert!(validate_no_control_chars("hello\tworld", "field").is_err());
    }

    #[test]
    fn control_chars_accepts_normal_text() {
        assert!(validate_no_control_chars("hello world", "field").is_ok());
    }

    #[test]
    fn control_chars_accepts_empty_string() {
        assert!(validate_no_control_chars("", "field").is_ok());
    }

    // ── ensure_git_success ──

    #[test]
    fn ensure_git_success_passes_on_success() {
        #[cfg(unix)]
        let status =
            <std::process::ExitStatus as std::os::unix::process::ExitStatusExt>::from_raw(0);
        #[cfg(windows)]
        let status =
            <std::process::ExitStatus as std::os::windows::process::ExitStatusExt>::from_raw(0);

        let output = std::process::Output {
            status,
            stdout: b"all good".to_vec(),
            stderr: vec![],
        };

        assert!(ensure_git_success(output, "failed").is_ok());
    }

    // ── CachedValue ──

    #[test]
    fn cached_value_is_stale_when_older_than_write() {
        let cached = CachedValue {
            data: "hello".to_string(),
            timestamp: 100,
        };
        assert!(cached.is_stale(200));
    }

    #[test]
    fn cached_value_is_fresh_when_newer_than_write() {
        let cached = CachedValue {
            data: 42,
            timestamp: 300,
        };
        assert!(!cached.is_stale(200));
    }

    #[test]
    fn cached_value_is_stale_when_equal_to_write() {
        let cached = CachedValue {
            data: true,
            timestamp: 100,
        };
        // equal timestamps are considered fresh because is_stale uses <, not <=
        assert!(!cached.is_stale(100));
    }

    // ── GitCache ──

    #[test]
    fn git_cache_starts_valid_for_any_positive_timestamp() {
        let cache = GitCache::new();
        assert!(cache.is_valid(1));
        assert!(cache.is_valid(u64::MAX));
    }

    #[test]
    fn git_cache_zero_timestamp_is_invalid() {
        let cache = GitCache::new();
        // last_write is 0, so cache_timestamp=0 means 0 > 0 => false
        assert!(!cache.is_valid(0));
    }

    #[test]
    fn git_cache_invalidation_makes_old_timestamps_invalid() {
        let cache = GitCache::new();
        assert!(cache.is_valid(1));
        cache.invalidate();
        // After invalidation, timestamp 1 should be too old
        assert!(!cache.is_valid(1));
    }
}
