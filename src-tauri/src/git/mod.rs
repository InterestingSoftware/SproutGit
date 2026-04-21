// Git operations module - organized for maintainability
// Submodules: helpers (validation, actions, utilities), operations (commands),
// diff (diff-related handlers).
//
// Tier 1 APIs (GitTransaction, GitCache) and Tier 2 semantic operations
// (create_feature_worktree, etc.) are available for future composable operations.

pub mod diff;
pub mod helpers;
pub mod operations;
pub mod staging;

// Re-export only what's used by Tauri handlers and other modules
#[allow(unused_imports)]
pub use helpers::{
    normalize_existing_path, normalize_or_create_dir, validate_git_config_key,
    validate_non_option_value, validate_repo_url, GitAction, SystemAction,
};

#[allow(unused_imports)]
pub use operations::{
    CheckoutResult, CommitEntry, CommitGraphResult, CreateWorktreeResult, GitInfo, RefInfo,
    RefsResult, WorktreeInfo, WorktreeListResult,
};

#[allow(unused_imports)]
pub use diff::{DiffContentResult, DiffFileEntry, DiffFilesResult};
