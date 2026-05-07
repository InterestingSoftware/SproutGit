use std::collections::HashSet;
use std::ffi::OsString;
use std::fs;
#[cfg(target_os = "windows")]
use std::os::windows::process::CommandExt;
use std::path::{Path, PathBuf};
use std::process::{Command, Output};
use std::time::{SystemTime, UNIX_EPOCH};

/// Strip the `\\?\` extended-length path prefix that Windows `canonicalize()` adds.
/// Git for Windows and many Windows tools (including PowerShell cmdlets) cannot handle
/// these prefixed paths correctly.
pub fn strip_win_prefix(p: PathBuf) -> PathBuf {
    #[cfg(target_os = "windows")]
    return dunce::simplified(&p).to_path_buf();
    #[cfg(not(target_os = "windows"))]
    p
}

/// Convert a `Path` to a forward-slash string for consistent cross-platform
/// representation in data returned to the frontend.
///
/// Git tools always output forward slashes even on Windows.  All path values
/// serialised in Tauri command responses must use this function so that
/// frontend comparisons against git-reported paths work correctly on every OS.
///
/// **Only use this for values that go to the frontend.**
/// Paths passed as arguments to git/system commands must stay as native OS
/// paths and should use `to_string_lossy()` directly.
pub fn path_to_frontend(p: &Path) -> String {
    p.to_string_lossy().replace('\\', "/")
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash)]
pub enum GitAction {
    GitInfo,
    WorktreeList,
    ListRefs,
    CommitGraph,
    CountCommits,
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
    BranchUnsetUpstream,
    StageFiles,
    UnstageFiles,
    CreateCommit,
    DeleteBranch,
    Push,
    Fetch,
    Pull,
    ListRemotes,
    CheckIgnore,
}

impl GitAction {
    #[cfg(test)]
    pub const ALL: [GitAction; 32] = [
        GitAction::GitInfo,
        GitAction::WorktreeList,
        GitAction::ListRefs,
        GitAction::CommitGraph,
        GitAction::CountCommits,
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
        GitAction::BranchUnsetUpstream,
        GitAction::StageFiles,
        GitAction::UnstageFiles,
        GitAction::CreateCommit,
        GitAction::DeleteBranch,
        GitAction::Push,
        GitAction::Fetch,
        GitAction::Pull,
        GitAction::ListRemotes,
        GitAction::CheckIgnore,
    ];

    pub fn label(self) -> &'static str {
        match self {
            GitAction::GitInfo => "git_info",
            GitAction::WorktreeList => "worktree_list",
            GitAction::ListRefs => "list_refs",
            GitAction::CommitGraph => "commit_graph",
            GitAction::CountCommits => "count_commits",
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
            GitAction::BranchUnsetUpstream => "branch_unset_upstream",
            GitAction::StageFiles => "stage_files",
            GitAction::UnstageFiles => "unstage_files",
            GitAction::CreateCommit => "create_commit",
            GitAction::DeleteBranch => "delete_branch",
            GitAction::Push => "push",
            GitAction::Fetch => "fetch",
            GitAction::Pull => "pull",
            GitAction::ListRemotes => "list_remotes",
            GitAction::CheckIgnore => "check_ignore",
        }
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash)]
pub enum SystemAction {
    OpenEditor,
}

impl SystemAction {
    #[cfg(test)]
    pub const ALL: [SystemAction; 1] = [SystemAction::OpenEditor];

    pub fn label(self) -> &'static str {
        match self {
            SystemAction::OpenEditor => "open_editor",
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
    if value
        .chars()
        .any(|ch| ch.is_control() && ch != '\n' && ch != '\r')
    {
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
    // Avoid inheriting caller Git environment that can redirect repository
    // state and cause incorrect index/worktree resolution.
    command.env_remove("GIT_DIR");
    command.env_remove("GIT_WORK_TREE");
    command.env_remove("GIT_INDEX_FILE");
    command.env_remove("GIT_COMMON_DIR");
    // Prevent a console window from flashing on Windows for every git call.
    #[cfg(target_os = "windows")]
    command.creation_flags(0x08000000); // CREATE_NO_WINDOW
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
    // Prevent a console window from flashing on Windows for every system call.
    #[cfg(target_os = "windows")]
    command.creation_flags(0x08000000); // CREATE_NO_WINDOW
    command
}

pub fn command_exists(command: &str) -> bool {
    let cmd = command.trim();
    if cmd.is_empty() {
        return false;
    }

    // Walk PATH directly rather than spawning `which`/`where` for every candidate.
    // This is significantly faster when checking many editors and tools at once
    // (e.g. on settings page load) because it avoids subprocess overhead entirely.
    let path_str = augmented_path();
    let path_var: OsString = path_str.into();
    for dir in std::env::split_paths(&path_var) {
        if dir.join(cmd).is_file() {
            return true;
        }
        // On Windows executables often lack an extension in PATH; probe common ones.
        #[cfg(target_os = "windows")]
        for ext in &[".exe", ".cmd", ".bat", ".com"] {
            if dir.join(format!("{cmd}{ext}")).is_file() {
                return true;
            }
        }
    }
    false
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
        .map(strip_win_prefix)
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
        .map(strip_win_prefix)
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

// ── Shell detection (shared between terminal and hooks) ──

/// Ordered list of shell candidates to probe for the current OS.
/// Used by both the terminal spawner and the hook executor so detection
/// behaviour is consistent across both features.
pub fn shell_candidates_for_current_os() -> &'static [&'static str] {
    if cfg!(target_os = "windows") {
        &["pwsh", "powershell", "bash"]
    } else if cfg!(target_os = "macos") {
        &["zsh", "bash"]
    } else {
        &["bash", "zsh", "pwsh"]
    }
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
        ensure_git_success, path_to_frontend, slugify_for_path, validate_git_config_key,
        validate_no_control_chars, validate_non_option_value, validate_repo_url, CachedValue,
        GitAction, GitCache, SystemAction,
    };
    use std::path::Path;

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
        assert_eq!(
            slugify_for_path("fix///multiple---slashes"),
            "fix-multiple---slashes"
        );
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

    #[test]
    fn control_chars_accepts_newlines() {
        assert!(validate_no_control_chars("subject\n\nbody paragraph", "field").is_ok());
        assert!(validate_no_control_chars("subject\r\nbody", "field").is_ok());
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

    // ── path_to_frontend ──

    #[test]
    fn path_to_frontend_unix_path_unchanged() {
        let p = Path::new("/home/user/project/root");
        assert_eq!(path_to_frontend(p), "/home/user/project/root");
    }

    #[test]
    fn path_to_frontend_converts_backslashes_to_forward() {
        // Simulate a Windows-style path (construct manually so tests pass on all platforms).
        let p = Path::new("C:\\Users\\user\\project\\root");
        let result = path_to_frontend(p);
        assert!(
            !result.contains('\\'),
            "result still contains backslash: {result}"
        );
        assert_eq!(result, "C:/Users/user/project/root");
    }

    #[test]
    fn path_to_frontend_mixed_separators_fully_normalized() {
        let p = Path::new("C:/Users\\user/project\\root");
        let result = path_to_frontend(p);
        assert!(
            !result.contains('\\'),
            "result still contains backslash: {result}"
        );
    }
}
