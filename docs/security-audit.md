# Security Audit: Git and System Interactions

Revision: Initial draft
Scope: `src-tauri/src` git/system process execution paths (`git/operations.rs`, `workspace.rs`, `git/diff.rs`, `editor.rs`, `git/helpers.rs`)

## Summary

The backend now uses a centralized, registered command policy for git and system operations.

- Git actions are registered with `GitAction`.
- System actions are registered with `SystemAction`.
- Untrusted inputs are validated before command execution.
- Backend git commands run non-interactively (`GIT_TERMINAL_PROMPT=0`).
- Command lookup is cross-platform (`which` on Unix-like systems, `where` on Windows).
- Security-focused unit tests cover validation and action registration invariants.

## Findings and Remediation

### 1. Option-smuggling risk in untrusted git arguments (Resolved)

Risk:
Untrusted refs/keys/URLs could begin with `-` and be interpreted as options by git.

Remediation:

- Added `validate_non_option_value` and `validate_git_config_key`.
- Added `validate_repo_url`.
- Updated command paths to validate before execution.
- Added `--` boundaries for git config key/value operations.

### 2. No command registration for security-focused unit testing (Resolved)

Risk:
No explicit allowlist/registry for git/system action types, making audit/test coverage weaker.

Remediation:

- Added `GitAction` registry with explicit action labels.
- Added `SystemAction` registry with explicit action labels.
- Routed command execution through helper builders/executors that require an action enum.
- Added tests ensuring unique registry labels.

### 3. Platform-specific command detection (Resolved)

Risk:
Using `which` only can fail on Windows.

Remediation:

- Added cross-platform command lookup helper using `where` on Windows.

### 4. PATH separator portability issue (Resolved)

Risk:
Hardcoded `:` separator in PATH augmentation is not cross-platform.

Remediation:

- Replaced PATH manipulation with `split_paths`/`join_paths`.
- Added OS-specific preferred path entries with fallback behavior.

## Validation and Testing

Framework: Rust built-in unit tests (`cargo test`).

Current security-focused unit tests:

- Registry uniqueness for `GitAction`.
- Registry uniqueness for `SystemAction`.
- Rejection of option-injection prefix for untrusted values.
- Validation of git config key format.
- Validation of repository URL constraints.

CI requirement:

- `cargo test` runs in the Rust matrix job on Linux, macOS, and Windows.

## Residual Risk Notes

- `open_in_editor` executes a user-configured editor command by design. This is user-authorized local execution, but remains a privileged operation.
- Repository URL trust still depends on git transport security and user intent; input validation prevents command-flag injection, not malicious remote content.
- Additional defense opportunities include stricter ref syntax validation for specific operations and optional allowlist-based protocol policy for clone URLs.
