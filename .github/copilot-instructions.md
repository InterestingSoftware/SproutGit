# SproutGit — Copilot Instructions

## Repository

- **Owner / GitHub org**: [InterestingSoftware](https://github.com/InterestingSoftware)
- **Repo URL**: https://github.com/InterestingSoftware/SproutGit.git

## What is SproutGit?

Open-source, cross-platform Git desktop app with a **worktree-first** workflow. The MVP lets users clone/init repos, manage Git worktrees in a prescribed directory layout, view a commit graph, and create branches paired with worktrees.

## Tech Stack

| Layer | Technology | Notes |
|-------|-----------|-------|
| Desktop shell | **Tauri v2** | Rust backend, webview frontend |
| Frontend framework | **SvelteKit + Svelte 5** | SSR disabled (`ssr = false`), `adapter-static` for SPA |
| Language | **TypeScript** (frontend), **Rust** (backend) | |
| Styling | **Tailwind CSS v4** | via `@tailwindcss/vite` plugin |
| State (frontend) | Svelte 5 runes | `$state`, `$derived`, `$derived.by`, `$props`, `$effect` |
| State (persistent) | **SQLite** via `rusqlite` (bundled) + `rusqlite_migration` | workspace `state.db` + app-global `config.db` |
| Package manager | **pnpm** | Tauri hooks use `pnpm run dev` / `pnpm run build` |
| Git integration | CLI-based | Rust backend shells out to `git` via `std::process::Command` |

## Project Structure

```
sproutgit/
├── src/                          # SvelteKit frontend
│   ├── app.css                   # Global design tokens (--sg-* CSS vars), animations, light/dark theme
│   ├── lib/
│   │   ├── sproutgit.ts          # Typed API layer wrapping Tauri invoke() calls
│   │   ├── toast.svelte.ts       # Toast notification state (Svelte 5 rune module, no stores)
│   │   └── components/
│   │       ├── CommitGraph.svelte # SVG commit graph with lane algorithm, search, context menu, worktree markers
│   │       ├── Autocomplete.svelte # Filterable dropdown with keyboard nav, aria attributes
│   │       ├── ContextMenu.svelte  # Right-click context menu, auto-positions within viewport
│   │       ├── Spinner.svelte      # Animated loading spinner (sm/md/lg)
│   │       └── ToastContainer.svelte # Fixed-position toast renderer (auto-dismiss, slide animations)
│   └── routes/
│       ├── +layout.svelte        # Minimal: imports app.css, renders <slot />
│       ├── +layout.ts            # export const ssr = false
│       ├── +page.svelte          # Screen 1: Project picker (clone, open, recent projects)
│       └── workspace/
│           └── +page.svelte      # Screen 2: Workspace (worktree mgmt + commit graph)
├── src-tauri/
│   ├── src/
│   │   ├── lib.rs                # Tauri entry: registers all commands
│   │   ├── db.rs                 # Database connections + migration runner
│   │   ├── workspace.rs          # Workspace create/inspect/import commands
│   │   ├── hooks.rs              # Hook definitions, dependencies, run history
│   │   ├── git/                  # Git operations, helpers, diff, staging
│   │   └── ...                   # config, editor, github, terminal, watcher
│   ├── migrations/
│   │   ├── workspace/            # Migrations for per-workspace state.db
│   │   │   └── 001_initial_schema.sql
│   │   └── config/               # Migrations for app-global config.db
│   │       └── 001_initial_schema.sql
│   ├── tauri.conf.json           # App config: window 1200x800, min 900x600, resizable
│   ├── Cargo.toml                # Rust deps: tauri, rusqlite, rusqlite_migration, sea-orm, …
│   └── capabilities/default.json # Permissions: core, opener, dialog
├── docs/
│   ├── index.md                  # Documentation index; read first to discover relevant docs for a task
│   ├── requirements.md           # Full MVP requirements with P0/P1 features
│   └── design-review-and-screen-plan.md  # Screen architecture (8 screens planned)
└── package.json                  # pnpm scripts: dev, build, check, tauri
```

## Documentation Index (Required)

The `docs/` folder contains product, architecture, security, and workflow decisions that may be directly relevant to implementation work.

Agent requirements:

- At the start of each new task, read `docs/index.md` first to discover whether any repository docs are relevant.
- If a linked doc is relevant to the task, read it before making design or implementation decisions.
- When adding, renaming, removing, or substantially repurposing a document in `docs/`, update `docs/index.md` in the same change.
- Treat `docs/index.md` as the maintained entry point for the repository documentation set.

## Tauri Playwright Adapter (Required For E2E Changes)

When working on `e2e/**`, adapter fixtures, or Playwright/Tauri bridge behavior, read `docs/tauri-playwright-adapter-cheatsheet.md` before editing.

Key reminders:
- `TauriPage` is Playwright-like but not identical to `Page`.
- `TauriLocator.waitFor` expects a numeric timeout, not a Playwright options object.
- Keep plugin socket/port values consistent across setup/launch and worker processes for each run.
- In `tauri` mode, do not use `page.goto()` for app reset or startup navigation.
- Prefer per-spec `beforeEach` reset hooks over global Playwright lifecycle hooks for stateful E2E flows.
- For E2E isolation, reset both the test workspace directory and the isolated config DB, then return to the project picker with stable in-app navigation (`ensureHome()`-style helpers). Avoid making full webview reloads the default reset path for the suite.
- Current default runtime is headless Playwright in `e2e/playwright.config.ts`; do not switch to headed by default.
- During reset, clear cached workspace hints (`sg_workspace_hint`) and perform a verified in-webview reload so each test starts from a clean project picker state.

### E2E Selector Strategy (Required)

- Prefer `getByTestId(...)` for all E2E element interactions and waits.
- Use CSS selectors only when no stable test ID exists, and keep those selectors narrow and local.
- If an interaction depends on visual state (hover-only controls, transient overlays), add or use a dedicated test ID before introducing brittle structural selectors.
- **If a needed `data-testid` does not exist in the UI source, add it.** Never work around a missing test ID with fragile structural selectors — add the `data-testid` attribute to the component/template and use it in the test.

## Workspace Layout (User Projects)

SproutGit manages user repos in a prescribed directory layout:

```
<workspace>/
├── root/                  # Main bare-ish checkout (protected, don't work directly here)
├── worktrees/             # Managed worktrees created by SproutGit
│   ├── feature-foo/
│   └── bugfix-bar/
└── .sproutgit/            # SproutGit metadata
    └── state.db           # SQLite: workspace state (meta, hooks, sessions)
```

## Rust Backend (`src-tauri/src/lib.rs`)

### Structs (all `#[serde(rename_all = "camelCase")]`)

- `GitInfo` — installed, version
- `WorktreeInfo` — path, head, branch, detached
- `WorktreeListResult` — repo_path, worktrees
- `WorkspaceInitResult` — workspace_path, root_path, worktrees_path, metadata_path, state_db_path, cloned
- `WorkspaceStatus` — workspace_path, root_path, worktrees_path, metadata_path, state_db_path, is_sproutgit_project, root_exists, worktrees_exists, metadata_exists, state_db_exists
- `RefInfo` — name, full_name, kind, target
- `RefsResult` — repo_path, refs
- `CommitEntry` — hash, short_hash, parents, author_name, author_date, subject, refs
- `CommitGraphResult` — repo_path, commits
- `CreateWorktreeResult` — worktree_path, branch, from_ref

### Tauri Commands

| Command | Purpose |
|---------|---------|
| `git_info` | Check Git installation and version |
| `create_sproutgit_workspace` | Create managed workspace, optionally clone a repo URL |
| `inspect_sproutgit_workspace` | Validate an existing SproutGit project directory |
| `list_worktrees` | Enumerate Git worktrees with branch/HEAD info |
| `list_refs` | Fetch branches & tags sorted by commit date |
| `get_commit_graph` | Structured commit log with parents, refs (limit 20-400) |
| `create_managed_worktree` | Create a new worktree under `worktrees/` dir |

### Helper Functions

- `run_git(args)` — Execute `git` with args, capture stdout
- `ensure_git_success(args)` — Run git, return error on non-zero exit
- `normalize_existing_path` / `normalize_or_create_dir` — Path canonicalization
- `initialize_workspace_db(path)` — Run workspace migrations, creating `state.db` if needed
- `slugify_for_path(name)` — Branch name → filesystem-safe slug
- `now_epoch_seconds()` — Current Unix timestamp

### Important Patterns

- Clone uses `--progress` flag with piped stderr, emitting `clone-progress` Tauri events via `tauri::Emitter` for real-time UI feedback
- `create_sproutgit_workspace` takes `app_handle: tauri::AppHandle` for event emission
- Commit graph uses `\x1e` (record separator) as field delimiter in git log format
- All git operations use `git -C <path>` to target specific repos

## Frontend API (`src/lib/sproutgit.ts`)

Typed wrappers around `invoke()` from `@tauri-apps/api/core`. Every Rust struct has a matching TypeScript type. Key exports:

- `getGitInfo()`, `createWorkspace()`, `inspectWorkspace()`
- `listWorktrees()`, `listRefs()`, `getCommitGraph()`
- `createManagedWorktree()`
- `onCloneProgress(callback)` — Event listener helper using `@tauri-apps/api/event`

## Theme System

CSS custom properties with auto dark mode:

- Light mode: `:root { --sg-bg: #f5f5f5; --sg-primary: #1a8a5c; ... }`
- Dark mode: `@media (prefers-color-scheme: dark) { :root { --sg-bg: #1e1e2e; --sg-primary: #74c7a4; ... } }`
- All tokens prefixed `--sg-*`: bg, surface, surface-raised, border, border-subtle, text, text-dim, text-faint, primary, primary-hover, danger, warning, accent, input-bg, input-border, input-focus

Always use `var(--sg-*)` tokens in components. Never hardcode colors outside of `app.css`.

**Light and dark mode are both required.** Every component and UI surface must look correct in both. When designing or editing any UI:
- Use only `var(--sg-*)` tokens — never hardcode hex colors in components.
- Mentally verify the design in both light mode (`--sg-bg: #f5f5f5`, `--sg-text: #1e1e2e`) and dark mode (`--sg-bg: #1e1e2e`, `--sg-text: #cdd6f4`).
- Components that use Canvas or WebGL rendering (e.g. xterm.js terminals) require explicit theme objects for both modes — detect `window.matchMedia('(prefers-color-scheme: dark)').matches` at init time and apply the correct theme.
- For screenshot testing, `forceTheme()` in `e2e/helpers/screenshots.ts` handles CSS var injection and xterm canvas re-theming — keep it in sync with any new terminal-like components.

## Commit Graph Component

`CommitGraph.svelte` implements a hand-rolled lane assignment algorithm:

- **Algorithm**: Two-pass column allocation. First pass assigns lanes (first parent continues lane, others allocate new). Second pass resolves parent positions for line drawing.
- **Rendering**: SVG for lane lines (straight + bezier curves) alongside a commit list with subject, ref badges, short hash, author, date.
- **Search**: CMD/CTRL+F opens inline search bar. Matches by subject, short hash, or full hash. Enter/Shift+Enter navigates matches. Non-matching rows dim to 30% opacity.
- **Context Menu**: Right-click on commits, branches, or tags shows copy actions (hash, message, branch, worktree path). Uses `ContextMenu.svelte`.
- **Worktree Integration**: Accepts `worktrees` prop. Commits on worktree branches get a diamond node shape (vs circle), a "WT" badge, and a distinct accent-colored ref badge with ⌥ prefix. Worktree branches are highlighted in `--sg-accent` color.
- **Constants**: ROW_H=28, COL_W=16, NODE_R=4, 10 cycling lane colors.

## UI Components

### Toast System (`toast.svelte.ts` + `ToastContainer.svelte`)
- **State module**: `toast.svelte.ts` exports `toast.info()`, `toast.success()`, `toast.error()`, `toast.warning()`. Uses `$state` (no Svelte stores). Auto-dismiss after 4s by default.
- **Renderer**: `ToastContainer.svelte` mounted in `+layout.svelte`. Fixed top-right, slide-in/out animations, close button.

### Autocomplete (`Autocomplete.svelte`)
- Filterable dropdown with `items: {label, value, detail?}[]`. Supports keyboard nav (up/down/enter/escape), click outside to close.
- Two-way binding via `bind:value`. `onselect` callback. ARIA combobox role.
- Used for source branch selection in the workspace sidebar.

### Context Menu (`ContextMenu.svelte`)
- `items: MenuItem[]` with `{label, action, icon?, danger?}` or `{separator: true}`.
- Auto-adjusts position to stay within viewport bounds. Closes on click outside or Escape.

### Spinner (`Spinner.svelte`)
- Sizes: `sm`, `md`, `lg`. Optional `label` text. Uses `--sg-primary` color.

### Form Controls (`Checkbox.svelte` + `Select.svelte`)
- Use shared form controls from `src/lib/components/` instead of ad-hoc checkbox/select markup in feature components.
- `Checkbox.svelte` is the source of truth for custom checkbox visuals and spacing behavior. Keep checked/unchecked icon rendering layout-stable to avoid row height shifts.
- `Select.svelte` is the source of truth for themed dropdowns. Prefer it over native `<select>` styling repeated inline.

## Database Architecture

SproutGit uses two SQLite databases, each with its own versioned migration set.

### Two databases

| Database | Path | Purpose |
|----------|------|---------|
| **Workspace DB** | `<workspace>/.sproutgit/state.db` | Per-project state: meta, hook definitions, hook runs, worktree sessions |
| **Config DB** | OS app-data dir (`~/Library/Application Support/SproutGit/config.db` on macOS) | App-global settings and recent workspace list |

A SproutGit workspace is identified by the presence of `state.db` (not a `project.json` — that file no longer exists).

### Migration system (`rusqlite_migration`)

Migrations are plain `.sql` files embedded at compile time via `include_str!` and applied by `rusqlite_migration` on every database open. Version state is tracked automatically in a `__migrations` table that the library manages.

**File layout:**
```
src-tauri/migrations/
  workspace/
    001_initial_schema.sql   ← tables/indexes for state.db
    002_next_change.sql      ← (future)
  config/
    001_initial_schema.sql   ← tables/indexes for config.db
```

**How migrations are registered (`src-tauri/src/db.rs`):**
```rust
static WORKSPACE_MIGRATIONS: LazyLock<Migrations<'static>> = LazyLock::new(|| {
    Migrations::new(vec![
        M::up(include_str!("../migrations/workspace/001_initial_schema.sql")),
        // append new migrations here in order
    ])
});
```

**Rules:**
- Never modify an already-shipped migration file. Add a new numbered file instead.
- Append the new `M::up(include_str!("../migrations/<db>/<NNN>_….sql"))` entry to the correct `LazyLock` vec.
- Indexes that reference a column added in the same migration must appear after that `ALTER TABLE` in the same file, or in a later migration file.
- Do not create bespoke `PRAGMA table_info` checks — the framework handles idempotency.

### `db.rs` public API

- `connect_workspace_db(workspace_path)` — Runs workspace migrations then returns a SeaORM connection.
- `connect_config_db()` — Runs config migrations then returns a SeaORM connection.
- `initialize_workspace_db(workspace_path)` — Runs workspace migrations only (no SeaORM connection returned); used during workspace creation.
- `write_workspace_meta(db_path, …)` — Inserts identifying path metadata into the `meta` table using `INSERT OR IGNORE` (preserves `created_at` across re-opens).

## Recent Hook Findings

- Hook dependency compatibility rule: dependencies may be same-trigger or `manual`; incompatible cross-trigger links should fail validation clearly.
- Hook shell handling must use runtime detection of available shells. On Windows, support both `pwsh` and `powershell` fallback.

## Animations

Global keyframes defined in `app.css`:
- `sg-fade-in` — content entrance (opacity + translateY)
- `sg-slide-up` / `sg-slide-down` — directional slide entrances
- `sg-toast-in` / `sg-toast-out` — toast slide from right
- `sg-spin` — loading spinner rotation
- `sg-pulse` — skeleton loading pulse

## Development Commands

```bash
# Prerequisites: source cargo and nvm
source "$HOME/.cargo/env"
source ~/.nvm/nvm.sh

# Install deps
pnpm install

# Validate everything compiles
pnpm run check          # svelte-check
pnpm run build          # vite build
cd src-tauri && cargo check  # Rust check

# Linting & formatting
pnpm run lint           # oxlint
pnpm run lint:fix       # oxlint with autofix
cargo clippy --all-targets -- -D warnings  # Clippy lints (in src-tauri/)
cargo fmt --check       # Format check (in src-tauri/)

# Auto-format code
pnpm run format         # Prettier (frontend)
cargo fmt               # rustfmt (backend)

# Run security tests
pnpm run test:security  # Rust security unit tests

# Run in development
pnpm run tauri dev

# VS Code task (with nvm support)
# Defined as: zsh -lc 'source ~/.nvm/nvm.sh && npm run tauri dev'
```

## Linting & Code Quality

**Rust:**
- **Clippy** — Configured in `src-tauri/Cargo.toml` with `[lints]` section. Enforces security, correctness, complexity checks.
- **rustfmt** — Configuration in `rustfmt.toml`. Max width 100 chars, consistent style.
- **Convenience alias** — `cd src-tauri && cargo lint` runs clippy with `-D warnings`.

**Frontend (TypeScript + Svelte):**
- **oxlint** — Fast Rust-based linter configured in `.oxlintrc.json`. Checks security, best practices, unused variables.
- **Prettier** — Configured in `.prettierrc`. Print width 100, 2-space tabs, single quotes, Svelte support via plugin.
- **Before commit** — Run `pnpm run lint:fix && pnpm run format` to auto-fix issues.

**CI Integration:**
- All linters run in GitHub Actions on every push (see `.github/workflows/`)
- Linting failures block PR merge
- Format violations reported as annotations on PR

## Release Notes Standard (Required)

Every pull request the agent creates or updates **must** include a `## Release Notes` section in the PR body. The CI pipeline extracts this section and prepends it to the GitHub Release created when the PR merges to `main`.

**Format:**
1. One to three sentences explaining what the change is and why it matters — written for a user, not a developer.
2. A bullet list of specific user-facing changes. Skip purely internal work (refactors, CI fixes, test-only changes) unless it has a visible effect.

**Example:**

```markdown
## Release Notes

This release hardens the E2E test setup so the Playwright testing bridge is never included in production builds, and fixes concurrent test runs interfering with each other.

- `tauri-plugin-playwright` is now compiled only when the `e2e-testing` Cargo feature is active — it is absent from all production builds
- E2E test run directories now use 12-hour TTL cleanup instead of deleting all sibling runs at startup, making concurrent CI runs safe
- Production capability manifest no longer grants Playwright permissions
```

**Rules:**
- Always write this section before opening or updating a PR — do not omit it.
- Use plain language. Avoid Rust/TypeScript jargon in the explanatory sentences.
- If a PR contains no user-facing changes (e.g. pure CI/infra work), write: `No user-facing changes in this release.`

## Agent Interaction Rules

- **Pause and ask when the user asks multiple questions or a request has multiple open design decisions.** Use `vscode_askQuestions` to collect answers before implementing. Do not assume and proceed; gather answers first.
- This is especially important for cross-cutting concerns like testing strategy, CI setup, and architectural choices.
- **Never push without explicit user approval.** Before running `git push` (or any command that publishes commits to a remote), ask the user for confirmation in the current thread and wait for a clear yes.

## Coding Conventions

- **Svelte 5 runes only** — Use `$state`, `$derived`, `$props`. No legacy `let` reactivity or stores.
- **Component props** — Use `type Props = { ... }; let { ... }: Props = $props();`
- **Tailwind utility classes** — Inline in templates. Use `var(--sg-*)` for theme-aware colors.
- **Rust serde** — All structs use `#[serde(rename_all = "camelCase")]` for JS interop.
- **Error handling** — Rust commands return `Result<T, String>`. Frontend uses try/catch on `invoke()`.
- **No stores** — All page state uses `$state` directly in `<script>` blocks.
- **Imports** — Frontend API types come from `$lib/sproutgit`. Components from `$lib/components/`.

## Security And Cross-Platform Rules (Required)

When adding or changing **any** git or system interaction, follow all rules below.

- **Secure-by-default execution**: Never use shell interpolation (`sh -c`, `bash -c`, PowerShell `-Command`) for git/system actions. Always call executables directly with explicit argument vectors.
- **Injection safety**: Treat all user-controlled values (refs, branch names, config keys, paths, URLs) as untrusted. Trim, validate, and reject values that are empty, start with `-`, or contain control characters.
- **Escalation safety**: Do not execute arbitrary repo-provided hooks/scripts implicitly. Keep `GIT_TERMINAL_PROMPT=0` for non-interactive backend operations.
- **Option-boundary safety**: For commands that accept untrusted values, use argument boundaries (for example `--` when supported) to prevent option smuggling.
- **System command registry**: Route all git/system process execution through registered helpers (`GitAction` / `SystemAction`) so behavior is auditable and testable.
- **Cross-platform compatibility**: Assume macOS, Linux, and Windows on every change. Avoid OS-specific shell utilities unless a platform-specific fallback exists.
- **Path handling**: Use `Path`/`PathBuf` and platform-aware path/env separators. Do not hardcode `:` as PATH separator.
- **Path serialization — frontend-bound values**: Any `Path`/`PathBuf` value serialised in a Tauri command response (struct fields, `Ok(...)` return values) **must** be converted with `path_to_frontend()` from `crate::git::helpers`, not with `to_string_lossy()`. Git always outputs forward slashes on every OS; using the same convention prevents frontend path-comparison mismatches on Windows. Paths passed as arguments to git/system commands should stay as native OS paths via `to_string_lossy()` directly.
- **Least privilege and clear errors**: Fail closed on invalid input and return clear, user-safe error messages.

## Security Testing Requirements

- Use Rust built-in unit testing (`cargo test`) for backend security tests.
- Add/maintain unit tests for input validation and command registration invariants.
- Run security-focused tests before committing.
- CI must execute these tests on all supported OS targets.

## Code Quality Checklist (Before Committing)

Always run the following before pushing code:

**Frontend:**
```bash
pnpm run lint      # Check code with oxlint (fast, Rust-based)
pnpm run lint:fix  # Auto-fix linting issues
pnpm run format    # Format code with Prettier
pnpm run check     # TypeScript type check
```

**Backend:**
```bash
cd src-tauri
cargo clippy --all-targets -- -D warnings  # Check for issues
cargo fmt --check                           # Check formatting
cargo test --lib                            # Run unit tests
```

**Commit only when:**
- ✅ `pnpm run lint` returns 0 warnings, 0 errors
- ✅ `pnpm run check` passes (0 TypeScript errors)
- ✅ `cargo clippy` passes (0 warnings with `-D warnings`)
- ✅ `cargo test --lib` passes (all tests)
- ✅ Code is formatted (`cargo fmt` and `pnpm run format`)

## Composability & Platform Extensibility

### Tier 1: GitTransaction Builder (Implemented ✓)

Compose multi-step git operations that execute atomically—failing on first error without partial state.

```rust
// src-tauri/src/git/helpers.rs
pub struct GitTransaction {
    repo_path: PathBuf,
    ops: Vec<(GitAction, Vec<String>)>,
}

impl GitTransaction {
    pub fn new(repo_path: impl AsRef<Path>) -> Self { ... }
    pub fn git_op(mut self, action: GitAction, args: &[&str]) -> Self { ... }
    pub fn execute(self) -> Result<Vec<Output>, String> { ... }
}
```

**Example: Create feature branch with atomic semantics**

```rust
GitTransaction::new(&repo_path)
    .git_op(GitAction::CreateManagedWorktree, &["worktree", "add", "-b", &branch, ...])
    .git_op(GitAction::Checkout, &["checkout", &branch])
    .execute()?  // Returns Vec<Output> or error on first failure
```

**Benefits:**
- Atomic: all-or-nothing semantics
- Clear intent: sequence of operations visible at a glance
- Rollback-ready: foundation for future undo functionality
- Testable: each op can be validated independently

### Tier 1: GitCache Infrastructure (Implemented ✓)

Foundation for memoizing expensive read operations with write-based invalidation.

```rust
// src-tauri/src/git/helpers.rs
pub struct CachedValue<T: Clone> {
    pub data: T,
    pub timestamp: u64,
}

pub struct GitCache {
    last_write: RefCell<u64>,
}

impl GitCache {
    pub fn new() -> Self { ... }
    pub fn invalidate(&self) { ... }  // Call before any write op
    pub fn is_valid(&self, cache_timestamp: u64) -> bool { ... }
}
```

**Usage pattern (ready for implementation):**
- Cache refs to avoid repeated `git branch -a` calls
- Cache status to avoid repeated `git status --porcelain` calls
- Call `cache.invalidate()` in any write operation (create, delete, reset, etc.)
- Check cache validity before fetch: if valid, return cached result

**Estimated win:** 30-40% reduction in read-heavy workflows.

### Tier 2: Semantic High-Level Operations (Implemented ✓)

Pre-built, intent-clear wrappers that reduce client-side orchestration complexity.

```rust
// src-tauri/src/git.rs

/// Create a feature branch worktree (clearer than create_managed_worktree)
pub async fn create_feature_worktree(
    root_path: String,
    worktrees_path: String,
    source_ref: String,
    feature_name: String,
) -> Result<CreateWorktreeResult, String> { ... }

/// Switch worktree branch (semantic alias for checkout with auto-stash)
pub async fn switch_worktree_branch(
    worktree_path: String,
    target_ref: String,
    auto_stash: bool,
) -> Result<CheckoutResult, String> { ... }

/// Reset worktree to clean state (hard reset + clean untracked)
pub async fn reset_worktree_to_ref(
    worktree_path: String,
    target_ref: String,
) -> Result<String, String> { ... }
```

**Frontend code becomes clearer:**

```typescript
// BEFORE: Low-level operations scattered in frontend
await createManagedWorktree(root, worktrees, sourceRef, branchName);
await checkoutWorktree(worktreePath, targetRef, true);

// AFTER: Intent-clear semantic operations
await createFeatureWorktree(root, worktrees, sourceRef, featureName);
await switchWorktreeBranch(worktreePath, targetRef, true);
```

### Tier 2: Parallel Operations (Pattern for Future Use)

Use Tauri's async/await with tokio for concurrent git operations.

```rust
pub async fn fetch_parallel_data(repo_path: String) -> Result<WorkspaceSnapshot, String> {
    let refs_fut = list_refs(repo_path.clone());
    let status_fut = get_status(repo_path.clone());
    let graph_fut = get_commit_graph(repo_path.clone(), None);

    // Join all futures in parallel
    let (refs, status, graph) = tokio::try_join!(
        refs_fut,
        status_fut,
        graph_fut,
    )?;

    Ok(WorkspaceSnapshot { refs, status, graph })
}
```

**Benefits:**
- Non-blocking: no sequential waiting
- ~30% faster for batch reads
- Uses Tauri's built-in tokio runtime (no extra dependency)
- Perfect for workspace initialization

### Tier 3: Instrumentation & Middleware (Future)

Add logging, metrics, and tracing for observability:
- Log cache hits vs misses
- Measure git operation latency
- Track error rates by operation type
- Profile hot paths

### Recommended Next Steps

1. **Activate caching** — Implement refs and status caching in existing commands
2. **Measure impact** — Profile before/after cache activation
3. **Implement parallel fetch** — Use pattern above for workspace initialization
4. **Add instrumentation** — Log/trace git operations (Tier 3)
5. **Document custom operations** — Add semantic ops as you create them

## Loading UI Patterns

**All async operations must have an associated loading state.** This ensures users understand that work is happening and prevents duplicate submissions.

### Frontend Loading States

Every async operation requires three elements:

1. **State variable** — `let opName = $state(false)` for single ops, or `let opName = $state<string | null>(null)` for multi-item ops (e.g., which worktree is deleting)
2. **Set during operation** — Set to `true` (or the identifier) before `invoke()`, reset in `finally` block
3. **UI feedback** — Show spinner + label, disable submit button, or show progress indicator

#### Pattern: Single Async Operation

```svelte
<script>
  let creating = $state(false);

  async function handleCreate(event: Event) {
    event.preventDefault();
    creating = true;
    error = "";
    try {
      await createManagedWorktree(...);
      toast.success("Worktree created");
    } catch (err) {
      toast.error(String(err));
    } finally {
      creating = false;
    }
  }
</script>

<button type="submit" disabled={creating}>
  {#if creating}
    <Spinner size="sm" /> Creating…
  {:else}
    Create worktree
  {/if}
</button>
```

#### Pattern: Multi-Item Async Operation

```svelte
<script>
  let deleting = $state<string | null>(null);  // Track which item is being deleted

  async function handleDelete(id: string) {
    deleting = id;
    try {
      await deleteItem(id);
    } finally {
      deleting = null;
    }
  }
</script>

<button disabled={deleting === item.id}>
  {#if deleting === item.id}
    <Spinner size="sm" />
  {:else}
    Delete
  {/if}
</button>
```

#### Pattern: Content/Data Loading

```svelte
<script>
  let loading = $state(true);
  let graphData = $state(null);

  async function loadData() {
    loading = true;
    try {
      graphData = await getCommitGraph(...);
    } finally {
      loading = false;
    }
  }
</script>

<div class="flex flex-1 flex-col overflow-hidden">
  {#if loading}
    <div class="flex flex-1 items-center justify-center gap-2">
      <Spinner size="md" />
      <p class="text-xs text-[var(--sg-text-faint)]">Loading commit history…</p>
    </div>
  {:else}
    <CommitGraph commits={graphData} />
  {/if}
</div>
```

### Rules

- **Always set `false/null` in `finally`** — Guarantees cleanup even on error
- **Pair with `toast.error()` on catch** — Users need to know what went wrong
- **Disable interactive elements while loading** — `disabled={loading || creating}` for buttons
- **Show meaningful labels** — "Loading commit history…" > "Loading…"
- **Use consistent animations** — `style="animation: sg-fade-in 0.3s ease-out"` for loading containers

### Spinner Component

The `Spinner.svelte` component supports:
- **Sizes**: `sm`, `md`, `lg`
- **Label**: Optional text below spinner
- **Color**: Inherits `--sg-primary` automatically

```svelte
<Spinner size="md" label="Loading…" />
<Spinner size="sm" />  <!-- No label -->
```

## Known Issues & Gotchas

- `cargo` must be in PATH — always `source "$HOME/.cargo/env"` before running `tauri dev`
- `git clone --progress` writes to **stderr**, not stdout
- Tauri event emission requires `tauri::Emitter` trait in scope
- `format!()` in Rust: don't mix string concatenation with format placeholders — use `.join()` for building git format strings
- SQLite + SeaORM (`sqlx-sqlite`) integer decode: avoid `u64` in `FromQueryResult` structs; use `i64` for `INTEGER` columns (timestamps included)
- Svelte 5 `class:` directive with Tailwind arbitrary values (e.g., `class:bg-[var(--x)]/10={cond}`) works but looks odd
- Window overflow: parent containers must be `flex flex-col overflow-hidden` for child `flex-1 overflow-auto` to scroll properly
