# SproutGit Screen Architecture

> Authoritative reference for every screen in the MVP, how they connect, what data they need, and when a user sees each one.

---

## User flow overview

```
App launch
│
├─ No projects known ──────────────► [1] Project Picker
│                                        │
│                                        ├─ Clone + create workspace ─► [2] App Shell
│                                        │                                  └─► [3] First Worktree Setup
│                                        │                                        └─► [4] Main Workspace
│                                        │
│                                        └─ Open existing by path ────► [2] App Shell
│                                                                           └─► [4] Main Workspace
│                                                                                (or [3] if no managed worktrees)
│
└─ Has known projects ─────────────► [1] Project Picker
                                         │
                                         └─ Quick-open project ───────► [2] App Shell
                                                                            └─► [4] Main Workspace
                                                                                 (or [3] if no managed worktrees)

Inside [4] Main Workspace:
├─ Status / Stage / Commit ─────────── center pane, always visible
├─ Diff Inspector ──────────────────── right pane, driven by file selection
├─ History / Graph ─────────────────── [5] switchable tab in center pane
├─ Create Worktree ─────────────────── [6] modal overlay
├─ Prune Worktree ──────────────────── [7] confirmation dialog
└─ Global Switcher ─────────────────── [8] Cmd+K command palette overlay
```

---

## Screen inventory

| #  | Screen                     | Route / mount point              | Type             |
|----|----------------------------|----------------------------------|------------------|
| 1  | Project Picker             | `/`                              | Full page        |
| 2  | App Shell                  | `/workspace` layout              | Persistent frame |
| 3  | First Worktree Setup       | `/workspace` (conditional)       | Guided panel     |
| 4  | Main Workspace             | `/workspace`                     | Four-pane layout |
| 5  | History & Graph            | `/workspace` tab                 | Tab pane         |
| 6  | Create Worktree            | overlay on `/workspace`          | Modal            |
| 7  | Prune Worktree             | overlay on `/workspace`          | Confirm dialog   |
| 8  | Global Context Switcher    | overlay, any `/workspace` screen | Command palette  |

---

## [1] Project Picker

**When shown:** App launch, or user clicks "Project picker" from the workspace header.

**Purpose:** Get into a SproutGit workspace. No git operations happen here — just project selection or creation.

### Layout

```
┌─────────────────────────────────────────────────────────────┐
│                     SproutGit branding                       │
├─────────────────────────────────┬───────────────────────────┤
│                                 │                           │
│   Create new project            │   Known projects          │
│                                 │                           │
│   [Workspace folder ________]   │   project-a       [Open]  │
│   [Repository URL   ________]   │   project-b       [Open]  │
│                                 │   project-c       [Open]  │
│   [ Create project + clone ]    │                           │
│                                 │   ─────────────────────── │
│                                 │   Open by path            │
│                                 │   [path________] [Open]   │
│                                 │                           │
└─────────────────────────────────┴───────────────────────────┘
```

### Behavior

- **Create project**: calls `createWorkspace(path, url)` → navigates to `/workspace?workspace=<path>`
- **Open known project**: calls `inspectWorkspace(path)` → validates `.sproutgit/project.json` exists → navigates to `/workspace?workspace=<path>`
- **Open by path**: same validation flow as above
- **Known projects list**: persisted in user-profile config SQLite, sorted by last opened, capped at 20
- **Git version**: displayed as ambient indicator, not a blocker unless missing entirely

### Data requirements

| API call              | When                     |
|-----------------------|--------------------------|
| `getGitInfo()`        | On mount                 |
| `createWorkspace()`   | On "Create project"      |
| `inspectWorkspace()`  | On "Open" or "Open by path" |

### Transitions

| Action                  | Target                              |
|-------------------------|-------------------------------------|
| Successful create/open  | → `/workspace?workspace=<path>`     |
| Error                   | Stay on picker, show error inline   |

---

## [2] App Shell (persistent layout)

**When shown:** Always visible when any `/workspace` route is active.

**Purpose:** Persistent context header and navigation chrome that wraps all workspace screens. This is the "desktop client frame" — dense, always-visible, never scrolls away.

### Layout

```
┌─────────────────────────────────────────────────────────────┐
│  [≡]  SproutGit   Repo: my-project  ›  WT: feat/login  ›  │
│                    Branch: feat/login-ui          [⌘K] [⚙]  │
├─────────────────────────────────────────────────────────────┤
│                                                             │
│              (child route content fills here)                │
│                                                             │
└─────────────────────────────────────────────────────────────┘
```

### Context header contents

| Element                    | Source                              | Behavior on click             |
|----------------------------|-------------------------------------|-------------------------------|
| Project name               | dirname of `workspacePath`          | Opens [1] Project Picker      |
| Active worktree chip       | `selectedWorktree.path` basename    | Opens worktree dropdown       |
| Active branch chip         | `selectedWorktree.branch`           | Opens branch list dropdown    |
| Detached HEAD indicator    | `selectedWorktree.detached`         | Warning badge, no action      |
| `⌘K` button               | —                                   | Opens [8] Global Switcher     |
| Settings gear              | —                                   | Future: workspace settings    |

### Implementation note

This becomes a **SvelteKit layout** at `src/routes/workspace/+layout.svelte`. It loads workspace state once and passes it to child routes via context or shared store.

### Data requirements

| API call              | When                           |
|-----------------------|--------------------------------|
| `inspectWorkspace()`  | On layout mount                |
| `listWorktrees()`     | On layout mount + after mutations |

---

## [3] First Worktree Setup (guided panel)

**When shown:** User opens a workspace that has zero managed (non-root) worktrees.

**Purpose:** Guide the user to create their first managed worktree before doing any work. This enforces the "never work directly on root" principle.

### Layout

```
┌─────────────────────────────────────────────────────────────┐
│  Context header (from App Shell)                            │
├─────────────────────────────────────────────────────────────┤
│                                                             │
│  ┌───────────────────────────────────────────────────────┐  │
│  │                                                       │  │
│  │   Step 1 of 2: Pick a starting point                  │  │
│  │                                                       │  │
│  │   Root is cloned and ready. Before making changes,    │  │
│  │   create a managed worktree from an existing ref.     │  │
│  │                                                       │  │
│  │   Source ref:     [▼ main                        ]    │  │
│  │   New branch:     [feature/_____________________ ]    │  │
│  │   Worktree path:  <workspace>/worktrees/feature-xxx   │  │
│  │                   (auto-generated from branch name)   │  │
│  │                                                       │  │
│  │   ┌──────────────────────────────────────────────┐    │  │
│  │   │  Commit graph (last ~30 commits)             │    │  │
│  │   │  * abc1234 (main) Initial commit             │    │  │
│  │   │  * def5678 Add README                        │    │  │
│  │   │  ...                                         │    │  │
│  │   └──────────────────────────────────────────────┘    │  │
│  │                                                       │  │
│  │                    [ Create managed worktree → ]       │  │
│  │                                                       │  │
│  └───────────────────────────────────────────────────────┘  │
│                                                             │
└─────────────────────────────────────────────────────────────┘
```

### Behavior

- Loads refs and short graph on mount
- Ref selector shows branches first, then tags
- Branch name input auto-slugifies into worktree folder name as preview
- On create: calls `createManagedWorktree()` → transitions to [4] Main Workspace
- Cannot be skipped — the only way forward is creating a worktree

### Data requirements

| API call                   | When                 |
|----------------------------|----------------------|
| `listRefs()`               | On mount             |
| `getCommitGraph(limit=30)` | On mount             |
| `createManagedWorktree()`  | On "Create" submit   |

### Transitions

| Action                  | Target                          |
|-------------------------|---------------------------------|
| Worktree created        | → [4] Main Workspace            |
| Error                   | Stay, show error inline         |

---

## [4] Main Workspace (daily driver)

**When shown:** After a workspace is open and at least one managed worktree exists.

**Purpose:** This is where the user spends 95% of their time. Four-pane IDE-style layout for the core Git workflow: see status, stage files, review diffs, commit.

### Layout

```
┌─────────────────────────────────────────────────────────────┐
│  Context header (from App Shell)                            │
├────────────┬────────────────────────┬───────────────────────┤
│            │                        │                       │
│  Worktree  │  [Status] [History]    │  Diff inspector       │
│  sidebar   │                        │                       │
│            │  Unstaged changes      │  file.ts              │
│  ● feat/a  │    M  src/app.ts       │  ┌─────────────────┐  │
│    feat/b  │    A  src/new.ts       │  │ @@ -10,6 +10,8  │  │
│    fix/c   │    D  src/old.ts       │  │ - old line       │  │
│            │                        │  │ + new line       │  │
│  ────────  │  [ Stage selected ]    │  │   context line   │  │
│  Branches  │                        │  │ + added line     │  │
│    main    │  Staged changes        │  └─────────────────┘  │
│    develop │    M  src/app.ts       │                       │
│            │                        │  ─────────────────────│
│  ────────  │  [ Unstage selected ]  │  Commit composer      │
│  [+ New    │                        │                       │
│  worktree] │                        │  [commit message____] │
│            │                        │  [ Commit to feat/a ] │
│            │                        │                       │
├────────────┴────────────────────────┴───────────────────────┤
│  status bar: 3 unstaged · 1 staged · feat/a · abc1234       │
└─────────────────────────────────────────────────────────────┘
```

### Left sidebar: Worktree + branch rail

| Element                 | Behavior                                               |
|-------------------------|--------------------------------------------------------|
| Managed worktrees list  | Click to switch active worktree; active has bullet indicator |
| External worktrees      | Shown below managed, visually dimmed                   |
| Branch list             | Read-only list of local branches, dimmed if no worktree |
| "+ New worktree" button | Opens [6] Create Worktree modal                       |
| Context menu on worktree| Prune option → opens [7] Prune dialog                 |

### Center pane: Status / History tabs

**Status tab (default):**

| Element              | Behavior                                                    |
|----------------------|-------------------------------------------------------------|
| Unstaged files list  | Grouped file list with status badges (M/A/D/R)             |
| Staged files list    | Same grouping, below unstaged                               |
| Stage button         | Stages selected files (or all if none selected)             |
| Unstage button       | Unstages selected files                                     |
| File click           | Selects file → loads diff in right pane                     |

**History tab:**
- Switches center pane to [5] History & Graph view
- Same left sidebar and right pane remain

### Right pane: Diff inspector + Commit composer

| Element              | Behavior                                                    |
|----------------------|-------------------------------------------------------------|
| File path header     | Shows path of currently selected file                       |
| Diff view            | Unified diff with syntax highlighting, hunk headers         |
| Large file fallback  | "File too large to display" message with byte count         |
| Binary file fallback | "Binary file" badge, no diff rendered                       |
| Commit message input | Textarea, required before commit                            |
| Commit button        | Commits staged changes to active worktree's branch          |
| Branch label on btn  | "Commit to feat/a" — always shows target branch             |

### Status bar (bottom strip)

Shows at a glance: unstaged count, staged count, active branch, HEAD short hash.

### Data requirements

| API call              | When                                      |
|-----------------------|-------------------------------------------|
| `listWorktrees()`     | On mount, after worktree create/prune     |
| `getStatus()`         | On mount, after stage/unstage/commit      |
| `getDiff()`           | On file selection                         |
| `stageFiles()`        | On "Stage" action                         |
| `unstageFiles()`      | On "Unstage" action                       |
| `commit()`            | On "Commit" action                        |
| `listRefs()`          | On mount, for branch sidebar              |

### Transitions

| Action                       | Target                          |
|------------------------------|---------------------------------|
| Click worktree in sidebar    | Reload status for that worktree |
| Click "+ New worktree"       | → [6] Create Worktree modal     |
| Right-click worktree → Prune | → [7] Prune dialog              |
| Click "History" tab          | → [5] History & Graph tab       |
| Press ⌘K                     | → [8] Global Switcher           |
| Click project name in header | → [1] Project Picker            |

---

## [5] History & Graph (tab pane)

**When shown:** User clicks "History" tab in the center pane of [4] Main Workspace.

**Purpose:** Browse commit history with branch topology visualization. Select commits to inspect their diffs in the right pane.

### Layout

```
┌────────────────────────────────────────────────────┐
│  [Status]  [History]                               │
├──────────┬─────────────────────────────────────────┤
│  Graph   │  Commit list                            │
│  lanes   │                                         │
│   │      │  abc1234  feat: add login   (feat/a)    │
│   │\     │  def5678  fix: typo         (main)      │
│   │ │    │  ghi9012  chore: deps                   │
│   │ │    │  jkl3456  feat: signup                  │
│   │/     │  mno7890  initial commit    (tag: v0.1) │
│   │      │                                         │
│          │                       [Load more ↓]     │
└──────────┴─────────────────────────────────────────┘
```

### Behavior

| Element              | Behavior                                                |
|----------------------|---------------------------------------------------------|
| Graph lanes column   | SVG-rendered branch topology (colored per branch)       |
| Commit row           | Hash, subject, author, relative date, ref decorations   |
| Click commit         | Loads commit diff summary in right pane (file list + diff) |
| Ref badges           | Branch names (green), tags (yellow), HEAD (red)         |
| Load more            | Fetches next page of history                            |
| Scroll sync          | Graph lanes and commit list scroll in lockstep          |

### Data requirements

| API call                        | When                    |
|---------------------------------|-------------------------|
| `getCommitGraph(limit=120)`     | On tab open             |
| `getCommitDetails(hash)`        | On commit row click     |

### Implementation note — graph rendering

Phase 1 (MVP): ASCII graph from `git log --graph` displayed in monospace, as currently implemented. Functional, not pretty.

Phase 2 (post-MVP): Structured commit data with precomputed lane positions, rendered as SVG columns. This requires a backend change to return parsed commit objects with parent relationships and lane assignments instead of raw text.

---

## [6] Create Worktree (modal)

**When shown:** User clicks "+ New worktree" in the sidebar of [4] Main Workspace.

**Purpose:** Create a new managed worktree from a branch, tag, or commit ref. Same form as [3] First Worktree Setup but as a modal overlay — the user is already working, so keep them in context.

### Layout

```
┌─────────────────────────────────────────────────┐
│  Create managed worktree                    [✕]  │
├─────────────────────────────────────────────────┤
│                                                 │
│  Source ref:      [▼ main                    ]  │
│  New branch:      [feature/_______________   ]  │
│                                                 │
│  Path preview:                                  │
│  <workspace>/worktrees/feature-xxx              │
│                                                 │
│  [ Cancel ]              [ Create worktree → ]  │
│                                                 │
└─────────────────────────────────────────────────┘
```

### Behavior

- Ref selector: branches first, then tags, searchable
- Branch name validates: no spaces, no special chars, no duplicates
- Path preview updates live from slugified branch name
- On create: `createManagedWorktree()` → closes modal → refreshes worktree list → auto-switches to new worktree

### Data requirements

| API call                   | When               |
|----------------------------|---------------------|
| `listRefs()`               | On modal open       |
| `createManagedWorktree()`  | On submit           |

---

## [7] Prune Worktree (confirmation dialog)

**When shown:** User right-clicks a managed worktree and selects "Remove" or "Prune."

**Purpose:** Confirm destructive worktree removal. This deletes the worktree folder and cleans up Git metadata.

### Layout

```
┌─────────────────────────────────────────────────┐
│  Remove worktree                            [✕]  │
├─────────────────────────────────────────────────┤
│                                                 │
│  ⚠ This will delete the worktree directory      │
│  and remove the Git worktree reference.         │
│                                                 │
│  Worktree: feature/login-ui                     │
│  Path:     /Users/.../worktrees/feature-login   │
│  Branch:   feature/login-ui                     │
│                                                 │
│  □ Also delete the branch                       │
│                                                 │
│  [ Cancel ]               [ Remove worktree ]   │
│                                                 │
└─────────────────────────────────────────────────┘
```

### Behavior

- Shows worktree details for confirmation
- Optional checkbox to also delete the local branch
- If worktree has uncommitted changes, show additional warning: "This worktree has uncommitted changes that will be lost."
- On confirm: `pruneWorktree()` → closes dialog → refreshes worktree list → switches to next available worktree

### Data requirements

| API call                 | When               |
|--------------------------|---------------------|
| `pruneWorktree()`        | On confirm          |
| `getStatus()` (optional) | On dialog open, to warn about uncommitted changes |

---

## [8] Global Context Switcher (command palette)

**When shown:** User presses `⌘K` (macOS) / `Ctrl+K` (Windows/Linux) from any workspace screen.

**Purpose:** Keyboard-first rapid navigation. Search and switch between worktrees, branches, and run quick actions without mouse.

### Layout

```
┌─────────────────────────────────────────────────┐
│  [🔍  Search worktrees, branches, actions... ]   │
├─────────────────────────────────────────────────┤
│                                                 │
│  MANAGED WORKTREES                              │
│    ● feat/login-ui                              │
│      fix/header-crash                           │
│      chore/deps-update                          │
│                                                 │
│  BRANCHES                                       │
│    main                                         │
│    develop                                      │
│                                                 │
│  ACTIONS                                        │
│    + New managed worktree                       │
│    + New branch + worktree                      │
│      Open project picker                        │
│                                                 │
└─────────────────────────────────────────────────┘
```

### Behavior

| Element              | Behavior                                                |
|----------------------|---------------------------------------------------------|
| Search input         | Fuzzy filter across all sections                        |
| Worktree row         | Enter → switch active worktree                          |
| Branch row           | Enter → offer to create worktree from this branch       |
| Action row           | Enter → execute (open modal, navigate, etc.)            |
| Arrow keys           | Navigate rows                                           |
| Escape               | Close palette                                           |
| Active worktree      | Marked with bullet, sorted first                        |

### Data requirements

| API call              | When               |
|-----------------------|---------------------|
| `listWorktrees()`     | On open             |
| `listRefs()`          | On open             |

---

## Data flow summary

### Shared workspace state

All workspace screens share a common state store loaded by the App Shell layout:

```
WorkspaceContext {
  workspacePath: string
  rootPath: string
  worktreesPath: string
  worktrees: WorktreeInfo[]          // refreshed after mutations
  activeWorktreePath: string | null  // user selection
  refs: RefInfo[]                    // refreshed after mutations
}
```

This is loaded once by the `/workspace` layout and exposed to all child components via Svelte context. Mutations (create worktree, prune, commit, etc.) trigger targeted refreshes.

### Backend commands needed for full MVP

| Command                  | Status       | Used by screens        |
|--------------------------|--------------|------------------------|
| `git_info`               | ✅ Exists    | [1]                    |
| `create_sproutgit_workspace` | ✅ Exists | [1]                   |
| `inspect_sproutgit_workspace` | ✅ Exists | [1] [2]              |
| `list_worktrees`         | ✅ Exists    | [2] [3] [4] [8]       |
| `list_refs`              | ✅ Exists    | [3] [4] [5] [6] [8]   |
| `get_commit_graph`       | ✅ Exists    | [3] [5]               |
| `create_managed_worktree`| ✅ Exists    | [3] [6]               |
| `get_status`             | ❌ Needed    | [4] [7]               |
| `stage_files`            | ❌ Needed    | [4]                    |
| `unstage_files`          | ❌ Needed    | [4]                    |
| `commit`                 | ❌ Needed    | [4]                    |
| `get_diff`               | ❌ Needed    | [4] [5]               |
| `prune_worktree`         | ❌ Needed    | [7]                    |
| `get_commit_details`     | ❌ Needed    | [5]                    |
| `fetch`                  | ❌ P1        | [4] (toolbar)          |
| `push`                   | ❌ P1        | [4] (toolbar)          |

---

## Route structure

```
src/routes/
├── +layout.svelte              ← global CSS import only
├── +layout.ts                  ← ssr = false
├── +page.svelte                ← [1] Project Picker
└── workspace/
    ├── +layout.svelte          ← [2] App Shell (context header, shared state)
    ├── +page.svelte            ← [3] or [4] conditional on worktree count
    └── (no other child routes needed for MVP — tabs/modals are components)
```

Modals and overlays ([6] [7] [8]) are Svelte components mounted inside the workspace layout, not separate routes.

---

## Implementation order

| Phase | What                                              | Screens affected |
|-------|---------------------------------------------------|------------------|
| 1     | Workspace layout with context header              | [2]              |
| 2     | Conditional first-worktree vs main-workspace view | [3] [4]          |
| 3     | Backend: `get_status`, `stage`, `unstage`, `commit` | [4]            |
| 4     | Status pane + staging workflow                    | [4]              |
| 5     | Backend: `get_diff`                               | [4] [5]          |
| 6     | Diff inspector pane                               | [4]              |
| 7     | Commit composer                                   | [4]              |
| 8     | History tab with graph                            | [5]              |
| 9     | Create worktree modal                             | [6]              |
| 10    | Backend: `prune_worktree`                         | [7]              |
| 11    | Prune worktree dialog                             | [7]              |
| 12    | Global context switcher                           | [8]              |
| 13    | P1: fetch/push toolbar actions                    | [4]              |

---

## Library plan

| Need                    | Choice                  | Why                                    |
|-------------------------|-------------------------|----------------------------------------|
| Syntax highlighting     | Shiki (fine-grained)    | Tree-sitter quality, lazy-loadable     |
| Diff rendering          | Custom from parsed hunks| Keep control, avoid heavy deps early   |
| Graph lanes (phase 1)   | ASCII from git log      | Already implemented, ship fast         |
| Graph lanes (phase 2)   | SVG lanes from parsed data | Better UX, do after MVP core works  |
| Virtual scrolling       | Svelte virtual list     | File lists and history can be long     |
| Git operations          | CLI via Tauri commands  | Already established pattern            |

---

## Post-MVP screens (not in this plan)

These are documented in requirements.md but excluded from MVP implementation:

- Merge conflict editor
- Rebase/cherry-pick visual workflow
- AI commit message generation
- Issue tracker integration panels
- MCP control surface
- Workspace settings/preferences screen
