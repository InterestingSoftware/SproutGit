# Architecture: Git System Design

## Overview

SproutGit's backend uses a **registered action pattern** for git and system command execution, designed for security, auditability, and testability. This document assesses reusability, composability, and extensibility.

## System Design

### Registered Actions

All git and system operations route through enum-based action registries:

```rust
pub enum GitAction { GitInfo, WorktreeList, ListRefs, ..., Clone, Init }
pub enum SystemAction { CommandLookup, OpenEditor }
```

**Benefits:**
- ✅ Audit trail: every git operation is explicitly named
- ✅ Security: input validation and environment setup centralized
- ✅ Testing: unit tests can validate action uniqueness and invoke patterns
- ✅ Extensibility: add new actions by extending the enum

### Command Pipeline

```
User Input
    ↓
Validation (validate_non_option_value, validate_repo_url, etc.)
    ↓
GitAction::Xxx + args
    ↓
base_git_command() → sets PATH, GIT_TERMINAL_PROMPT, etc.
    ↓
Command::output() or Command::spawn()
    ↓
Result<Output, String>
```

## Reusability Assessment

### ✅ Strengths

1. **Validator functions are orthogonal**
   - `validate_no_control_chars()` — Generic control char check
   - `validate_non_option_value()` — Reusable "no leading dash" check
   - `validate_repo_url()` — Composable on top of `validate_non_option_value()`
   - Used across git.rs, diff.rs, editor.rs, workspace.rs

2. **Base command builders encapsulate setup**
   ```rust
   pub fn base_git_command() -> Command
   pub fn git_command(action: GitAction, args: &[&str]) -> Command
   pub fn system_command(action: SystemAction, program: &str, args: &[&str]) -> Command
   ```
   - New operations inherit PATH, environment, and action tracking automatically

3. **Helper utilities are standalone**
   - `augmented_path()` — Can be called from any module
   - `command_exists()` — Cross-platform lookup without git
   - `normalize_existing_path()`, `normalize_or_create_dir()` — Path utilities

4. **Security validators are reusable**
   - All modules use the same validation functions
   - Consistent error messages and behavior

### ⚠️ Limitations

1. **High-level operations are monolithic**
   - Each command (checkout, reset, clone) is a single function
   - Cannot decompose into sub-steps without refactoring
   - Example: `create_managed_worktree()` is 30 lines that can't be broken down

2. **No composability pattern for multi-step operations**
   - Cannot chain "create worktree + checkout + run setup" atomically
   - Example: To create a worktree and check out a branch requires two separate invocations:
     ```rust
     create_managed_worktree(...)?;  // Spawns git, returns
     checkout_worktree(...)?;        // Spawns git again
     ```
   - If the second fails, the worktree is orphaned with no rollback

3. **No operation-level batching**
   - Each function spawns git independently
   - Even related commands don't batch (could use `git worktree list && git branch -a` in one process)
   - Process spawning overhead dominates for I/O-bound operations

4. **Limited error aggregation**
   - Each function handles its own errors independently
   - Cannot collect partial results + errors from a multi-step sequence
   - Example: `delete_managed_worktree()` tries to prune if the removal fails, but errors are swallowed

## Composability Assessment

### Current Composability: 4/10

**Can compose:**
- Input validators (stack them: `validate_non_option_value()` → `validate_repo_url()`)
- Command builders (call `git_command()` with different args)
- Error handling (try-catch chains)

**Cannot easily compose:**
- Multi-step atomic operations (transaction/rollback pattern needed)
- Result aggregation (no collector/builder for complex results)
- Batch operations (no queue or pipeline abstraction)
- Conditional branching (if this git command succeeds, run that one)

### Example Gap: Create Feature Worktree

Current flow (requires 3 separate invocations in client code):

```rust
// User code must choreograph this:
create_managed_worktree(root, worktrees, "feature-foo", "main")?;
checkout_worktree(worktree_path, "feature-foo", false)?;
// Now set up: run hooks, install deps, etc. (outside of git system)
```

Ideal composable flow:

```rust
// One atomic operation with rollback
GitOp::new(repo_path)
  .create_worktree("feature-foo", from: "main")
  .checkout("feature-foo", auto_stash: true)
  .on_error(|e| { cleanup_worktree(...); Err(e) })
  .execute()?
```

## Performance Assessment

### ✅ Strengths

1. **Minimal overhead**
   - Direct process spawning (no RPC, IPC, or request serialization)
   - Single-pass stdout/stderr reading
   - No intermediate allocations in hot paths
   - All I/O is sequential (expected for git operations)

2. **PATH optimization**
   - Cross-platform deduplication in `augmented_path()`
   - Cached once at startup (PATH doesn't change mid-session)

3. **Smart validation**
   - Synchronous, small-footprint checks before spawning
   - Fail-fast prevents wasted process spawns

### 📊 Limitations & Opportunities

1. **Process spawn overhead** — Each operation spawns git independently
   - Typical git command: ~50ms on macOS (overhead dominated by process spawn)
   - Could batch related operations: `git status && git log` in one process (~80ms instead of ~100ms)
   - Doesn't matter for user-initiated actions, but matters for batch operations

2. **No caching** — Identical queries re-run every time
   - `list_refs()` called twice in quick succession = two git processes
   - Could cache with invalidation on write operations
   - Estimated win: 30-40% reduction for read-heavy workflows

3. **No async/parallel** — All operations are blocking
   - Frontend currently blocks on each git command
   - Could parallelize unrelated operations (e.g., fetch refs while listing worktrees)
   - Tauri command handler is async-capable; not utilized

## Extensibility Assessment

### ✅ Adding New Operations

**Very easy** — Add to `GitAction` enum, implement handler:

```rust
// In helpers.rs
pub enum GitAction {
    ...,
    TagCreate,  // New action
    TagDelete,
    TagList,
}

// In git.rs
#[tauri::command]
pub async fn tag_list(repo_path: String) -> Result<Vec<TagInfo>, String> {
    let repo = normalize_existing_path(&repo_path)?;
    let output = run_git(GitAction::TagList, &[
        "-C", &repo.to_string_lossy(), "tag", "--list"
    ])?;
    // Parse and return
}
```

**Security tests added automatically** — Tag uniqueness test in helpers::tests runs immediately.

### ⚠️ Limitations

1. **Cannot extend behavior** — All operations use the same execution path (spawn, capture output, done)
   - No hooks/callbacks
   - No middleware or instrumentation
   - No rate limiting or retry logic

2. **Cannot compose externally** — Client code must orchestrate multi-step sequences
   - No abstract interface for describing workflows
   - No operation queuing or scheduling

3. **Cannot plugin** — Operations are hardcoded in the enum
   - Would need significant refactor to support dynamic plugins

## Recommendations for a Better Platform

### Tier 1: High-Value, Low-Effort

**1. Add a `GitTransaction` builder pattern**
```rust
pub struct GitTransaction {
    ops: Vec<Box<dyn GitOp>>,
    on_error: Option<Box<dyn Fn() -> ()>>,
}

impl GitTransaction {
    pub fn new() -> Self { ... }
    pub fn run_git(action: GitAction, args: &[&str]) -> Self { ... }
    pub fn on_error(self, f: impl Fn() -> ()) -> Self { ... }
    pub fn execute(self) -> Result<Vec<Output>, String> { ... }
}
```
- **Benefit**: Multi-step operations with rollback; atomic from user perspective
- **Effort**: ~200 lines
- **Example**: `GitTransaction::new().create_worktree(...).checkout(...).execute()?`

**2. Add read-only caching with invalidation**
```rust
pub struct GitCache {
    refs: RefCell<Option<CachedValue<Vec<RefInfo>>>>,
    status: RefCell<Option<CachedValue<StatusOutput>>>,
}
```
- **Benefit**: 30-40% reduction for read-heavy workflows
- **Effort**: ~150 lines
- **Example**: Second `list_refs()` call returns cached result

### Tier 2: Medium-Value, Medium-Effort

**3. Add async/parallel operation support**
- Use `tokio` or `async-std` for parallel unrelated git operations
- **Benefit**: Faster batch operations, non-blocking frontend
- **Effort**: ~300 lines + dependency

**4. Add semantic high-level operations**
```rust
pub async fn create_feature_branch_with_worktree(
    repo_path: &str,
    branch_name: &str,
    from_ref: &str,
) -> Result<CreateFeatureBranchResult, String>
```
- Combines create + checkout + validation
- **Benefit**: Simpler client code, fewer edge cases
- **Effort**: ~100 lines per operation

### Tier 3: Lower-Priority

**5. Add middleware/instrumentation layer**
- Logging, metrics, tracing for each git operation
- **Benefit**: Observability, debugging, performance profiling

**6. Add plugin system**
- Dynamic operation registration
- **Benefit**: Third-party extensions
- **Effort**: ~500+ lines

## Verdict: Is It a Good Platform?

| Aspect | Rating | Notes |
|--------|--------|-------|
| **Security** | 9/10 | Excellent input validation, injection-safe |
| **Auditability** | 9/10 | All operations registered, testable |
| **Reusability** | 7/10 | Validators and helpers are reusable; high-level ops are not |
| **Composability** | 4/10 | Can't easily chain multi-step operations without manual orchestration |
| **Performance** | 7/10 | Efficient for single operations; could batch better |
| **Extensibility** | 6/10 | Easy to add new git operations; hard to extend behavior |
| **Async-Ready** | 6/10 | Uses async/await at Tauri boundary, but operations are blocking |

**Recommendation**: ✅ **Yes, it's a solid foundation**, but add a `GitTransaction` pattern (Tier 1) before building complex workflows. This adds composability and rollback semantics without breaking existing code.

The security and auditability are excellent. The main gap is composability for multi-step operations. Once that's addressed, it's a very capable platform.

## Proposed Extension: Worktree Lifecycle Hooks

### Why this fits the architecture

Worktree lifecycle hooks are a natural extension of the worktree-first model because users often need local environment setup/teardown around create/remove operations.

The existing command architecture should remain the security boundary:

- Git operations continue through registered `GitAction` paths
- Hook execution should use a dedicated registered system action type (for auditability)
- Trigger orchestration should happen in backend commands, not frontend choreography

### Persistence strategy

Current state DB initialization uses direct `rusqlite` SQL in `initialize_state_db()`.

For hooks and future app/workspace state, move to an ORM-backed model for maintainable evolution:

- Introduce ORM entities for `hook_definitions` and `hook_runs`
- Introduce ORM entities for global app config state (recent workspaces, app settings)
- Keep migrations explicit and versioned
- Migrate existing lightweight tables/repositories incrementally behind compatibility adapters

Use a dual-database model:

- User-profile config DB for app-level state
- Workspace DB (`.sproutgit/state.db`) for repository-local state

### Execution strategy

Attach hook orchestration to semantic lifecycle command paths:

- `before_worktree_create` -> run -> perform create -> `after_worktree_create`
- `before_worktree_remove` -> run -> perform remove -> `after_worktree_remove`

Execution rules:

- Critical hook failure aborts `before_*` operations
- Non-critical hook failures are logged and surfaced but do not block
- Force remove bypasses only failing non-critical hooks
- `after_*` failures are warning-only by default and are not rolled back
- Parallel execution allowed for independent groups
- Dependency DAG with AND semantics determines run readiness
- Timeouts and output limits enforced per hook run

### Security constraints for hook execution

Because this executes arbitrary local scripts, treat as explicit user-authorized code execution:

- Require clear UI warning and explicit enablement
- No privilege elevation workflow in app
- Validate trigger payload and paths before execution
- Use non-interactive shell modes where possible
- Persist run metadata for audit/debug visibility

### Implementation note

This feature should be implemented as a composable service module (for example `hooks.rs`) that can be called from worktree operations, rather than embedding hook logic directly into each command handler.
