# SproutGit Agent Instructions

> These instructions apply to every AI-assisted change in this repository.
> Shared by both entry points: [.github/copilot-instructions.md](../.github/copilot-instructions.md) and [CLAUDE.md](../CLAUDE.md).

**GitHub:** https://github.com/InterestingSoftware/SproutGit  
**Owner / org:** InterestingSoftware  
**Repo:** SproutGit  
**Clone URL:** https://github.com/InterestingSoftware/SproutGit.git

## Project overview

SproutGit is an Electron-based, cross-platform Git desktop app with a **worktree-first** workflow.

**Monorepo:** pnpm v11 workspaces + Turborepo v2  
**Dev command:** `pnpm dev`  
**Test command:** `pnpm test` (unit) / `pnpm test:e2e` (WebdriverIO E2E)  
**Typecheck:** `pnpm typecheck`  
**Lint:** `pnpm lint`  
**Dead code / unused deps:** `pnpm knip` (config: `knip.jsonc`) — CI gates on the files/dependencies/binaries categories only (`--exclude exports,types`); run without flags locally to see everything, including intentionally-unused library exports in `packages/ui` and `e2e/helpers*`.

---

## Stack & versions

| Technology | Version |
|---|---|
| Electron | 43 |
| electron-vite | 5 |
| electron-builder | 26 |
| React | 19 |
| TanStack Router | 1 |
| Zustand | 5 |
| Tailwind CSS | 4 (`@tailwindcss/vite`) |
| TypeScript | 5 |
| Drizzle ORM | latest |
| simple-git | latest |
| node-pty | latest |
| WebdriverIO | latest |

---

## Monorepo structure

```
app/                    ← Electron app (main + renderer + preload)
packages/
  git/                  ← @sproutgit/git — simple-git wrapper; all Git operations
  terminal/             ← @sproutgit/terminal — node-pty wrapper
  database/             ← @sproutgit/database — Drizzle + node:sqlite
  types/                ← @sproutgit/types — shared types + ALL IPC channel constants
  ui/                   ← @sproutgit/ui — shared React components
  providers/github/     ← @sproutgit/provider-github — GitHub OAuth + repo listing
  mcp-server/           ← @sproutgit/mcp-server — MCP server exposing worktree tools to external agents, see docs/mcp-server.md
  ts-config/            ← shared tsconfig
e2e/                    ← WebdriverIO end-to-end tests
website/                ← Astro marketing site
old/                    ← Legacy Tauri/SvelteKit source (do NOT modify)
```

---

## Main process (`app/src/main/`)

- **Entry point:** `app/src/main/index.ts`
  - Registers all IPC handlers on app startup
  - Creates `BrowserWindow` with `titleBarStyle: 'hiddenInset'` on macOS
  - Sets `app.name = 'SproutGit'` before `whenReady()`
  - Sets dock icon in dev mode via `app.dock?.setIcon()`
  - Registers macOS application menu via `Menu.setApplicationMenu()` — **required for Cmd+C/V/Z/X to work in text inputs**
  - Handles `open-file` event and sends `IPC.EVENT_OPEN_WORKSPACE` to renderer

- **IPC handlers:** `app/src/main/ipc/`
  - `git.ts` — Git operations (delegates to `@sproutgit/git`)
  - `workspace.ts` — workspace CRUD, recent workspaces, worktree metadata, hook run audit log
  - `workspace-init.ts` — import, init, inspect workspace (creates `.sproutgit/` layout)
  - `terminal.ts` — PTY create/write/resize/kill (delegates to `@sproutgit/terminal`)
  - `settings.ts` — user settings stored in config DB
  - `system.ts` — OS utilities (dialog, open external, home dir)
  - `github.ts` — GitHub OAuth + repo listing
  - `hooks.ts` — hook CRUD (local-hooks.json), repo-hook trust, and lifecycle execution — see "Hooks" below
  - `watcher.ts` — chokidar filesystem watcher → push events to renderer
  - `update.ts` — electron-updater auto-update
  - `agents.ts` — coding agent roster CRUD + launching an agent as a PTY session in a worktree
  - `commit-message-generator.ts` — runs the configured command against the staged diff to draft a commit message

---

## IPC contract

**Rule: all IPC channel names live in `packages/types/src/ipc.ts`.**

- Export name pattern: `IPC.DOMAIN_ACTION` (e.g., `IPC.GIT_STAGE_FILES`)
- String value pattern: `'domain:action'` (e.g., `'git:stageFiles'`)
- Event channels are prefixed `EVENT_` and use the string prefix `'event:'`

When adding a new IPC call:
1. Add the constant to `packages/types/src/ipc.ts`
2. Rebuild types: `pnpm --filter @sproutgit/types build`
3. Add the handler in the appropriate `app/src/main/ipc/*.ts` file
4. Expose it via `window.api` in `app/src/preload/index.ts` using `contextBridge.exposeInMainWorld`
5. Consume via `window.api.myNewCall()` in the renderer — never use `ipcRenderer` directly in the renderer

---

## Preload (`app/src/preload/index.ts`)

Exposes `window.api` (and types `Window.Api`) via `contextBridge`.

- Invoke calls: `ipcRenderer.invoke(IPC.CHANNEL, ...args)`
- Event subscriptions return an unsubscribe function:
  ```ts
  onMyEvent: (cb: (data: MyData) => void) => {
    const listener = (_e: Electron.IpcRendererEvent, data: MyData) => cb(data);
    ipcRenderer.on(IPC.MY_EVENT, listener);
    return () => ipcRenderer.removeListener(IPC.MY_EVENT, listener);
  },
  ```

---

## Renderer (`app/src/renderer/`)

### Routing

- **TanStack Router v1** with `createHashHistory()`
- Routes in `app/src/renderer/routes/`:
  - `__root.tsx` — root layout (ToastContainer, `onOpenWorkspace` subscription)
  - `index.tsx` — home/landing view (recent workspaces, clone, import)
  - `workspace.tsx` — main workspace view (worktree sidebar + content area)
  - `settings.tsx` — settings panel
- Navigation: `useNavigate()` from TanStack Router, or `window.location.hash = '#/route?param=value'`

### State management

- **Zustand v5**; stores in `app/src/renderer/stores/`
- `useWorkspaceStore` — active workspace path, gitRepoPath, worktrees, status
- `useUpdateStore` — update availability state

### Styling

- **Tailwind CSS v4** — utility classes only (no config file, uses CSS variables)
- CSS variables for brand/semantic colours defined in `app/src/renderer/tailwind.css`
- Custom variable prefix: `--sg-*`
- Use `cn()` (from `clsx`/`tailwind-merge`) for conditional class names
- **Icons:** use `lucide-react` for all renderer/UI icons. Do not introduce new icon libraries, emoji glyphs, or ad-hoc inline icon text when a Lucide icon exists.

### Workspace layout components

Located in `app/src/renderer/workspace/`:
- `WorktreeSidebar.tsx` — list of worktrees + compact icon toolbar
- `dialogs/` — `NewWorktreeDialog`, `DeleteWorktreeDialog`, `HooksDialog`, etc.

---

## Database (`@sproutgit/database`)

- **`node:sqlite`** (built into Electron ≥32) — no native binary dependencies
- Drizzle ORM for schema and migrations
- **Config DB:** `userData/config.db` — user settings, recent workspaces, per-worktree per-hook trust decisions
- **Workspace DB:** `<workspacePath>/.sproutgit/state.db` — worktree metadata, hook run audit log, per-workspace UI state, etc. Machine-local, never committed to git. Hook *definitions* themselves no longer live here — see "Hooks" below — this DB only keeps a legacy `hookDefinitions`/`hookDependencies` table pair around as a one-time migration source for workspaces created before that change.
- Schema in `packages/database/src/schema/`
- Migrations in `packages/database/migrations/` (two folders: `config/` and `workspace/`)
- **Always generate migrations with drizzle-kit — never write migration SQL by hand.**
  - Config schema: `cd packages/database && pnpm drizzle-kit generate --config=drizzle.config.config.ts`
  - Workspace schema: `cd packages/database && pnpm drizzle-kit generate --config=drizzle.workspace.config.ts`

---

## Git package (`@sproutgit/git`)

All git operations go through this package. Do not call `simple-git` directly from the main process — always import from `@sproutgit/git`.

Key modules:
- `client.ts` — simpleGit factory with defaults
- `commits.ts` — log, graph data
- `diff.ts` — diff, patch
- `staging.ts` — stage, unstage, commit
- `worktrees.ts` — list, add, remove worktrees
- `branches.ts` — create, delete, rename branches
- `remote.ts` — fetch, pull, push

---

## Terminal package (`@sproutgit/terminal`)

- `TerminalManager` in `packages/terminal/src/terminal-manager.ts`
- Manages a pool of `node-pty` instances keyed by `(workspacePath, worktreePath)`
- IPC handlers in `app/src/main/ipc/terminal.ts` delegate to `TerminalManager`

---

## Workspace layout on disk

```
<workspacePath>/
  .sproutgit/
    root/               ← bare git repository (git init --bare)
    worktrees/          ← managed worktrees (one subdirectory per worktree)
    state.db            ← workspace SQLite database
    local-hooks.json     ← local hook definitions (machine-local, not tracked by git)
  .sproutgit/root.git → symlink for compatibility (if needed)
```

Inside each worktree's own working copy (i.e. tracked by git, alongside the
project's source), an optional `sproutgit.hooks.json` lets a repo ship
lifecycle hooks that travel with `git clone`/`pull` instead of staying local
to one machine. See "Hooks" below.

---

## Hooks (`local-hooks.json` / `sproutgit.hooks.json`)

Local and repo hooks are stored **the same way** — a JSON file of
`HookFileDefinition`s (`packages/types/src/hooks.ts`) — just in different
files with different write/trust policies. This is the "native"
differentiation: which file a hook was read from, not a bolted-on DB flag.

- **Local:** `<workspacePath>/.sproutgit/local-hooks.json`. Not tracked by git,
  private to this machine, freely created/edited/deleted through the app
  (Workspace Hooks UI → `HOOK_CREATE`/`UPDATE`/`DELETE`/`TOGGLE`). Always
  trusted — nothing external ever wrote it.
- **Repo:** `<worktreePath>/sproutgit.hooks.json`. Tracked by git, travels
  with clone/pull, **read-only from the app** — edit the file and commit to
  change it. Surfaced in the UI with a "repo" badge and a lock icon.
- Shape: `{ "version": 1, "hooks": [ { name, trigger, executionTarget, shell, script, dependsOn?, ... } ] }`. Hooks are identified by `name` within their own file (not a DB id), and `dependsOn` references other hooks in the *same* file by name — a local hook can't depend on a repo hook or vice versa, since the two files are parsed and validated independently.
- Reading/writing/hashing lives in `app/src/main/hooks-file.ts` (`readHooksFile`, `writeLocalHooksFile`, `hashHookDefinition`). A hook's id throughout the app is `local:<name>` or `repo:<name>` (`makeHookId`/`parseHookId`).
- **Security-critical:** the repo file arrives via `git checkout`, so its scripts must never run automatically. Trust is **per hook**, not per file (`app/src/main/hooks-trust.ts`: `isHookTrusted`/`trustHook`) — editing or adding one hook doesn't invalidate trust already granted to the rest, keyed by a sha256 hash of that hook's own content. Never bypass `isHookTrusted()` to "just run it".
- Both sources are merged live on every read (`getEffectiveHooks` in `app/src/main/ipc/hooks.ts`) — nothing is cached in a DB. Workspaces created before this change had local hooks in the workspace DB's `hookDefinitions`/`hookDependencies` tables; the first read after upgrading migrates those rows into `local-hooks.json` once (`migrateLegacyLocalHooksIfNeeded`) and the DB tables are ignored from then on.

---

## Security rules

- **`nodeIntegration: false`** and **`contextIsolation: true`** always. Do not change these.
- All Node.js/system access must go through the context bridge.
- Never pass unsanitised user input to shell commands. Use `simple-git` APIs, not `exec`.
- Validate file paths received over IPC before passing to filesystem APIs.

---

## E2E testing (`e2e/`)

- **Framework:** WebdriverIO (`e2e/wdio.conf.ts`) with `wdio-electron-service`, driving the real Electron binary via WebDriver
- **Shared helpers:** `e2e/helpers.ts` exports plain async functions (not a Playwright-style fixture) — `gotoHash(hash)`, `goHome()`, `createTestRepo()`, `cleanupRepo()`, `closeAndCleanup()`, toast helpers — used alongside the WDIO globals `browser`/`$`/`expect`
- `gotoHash(hash)` sets `window.location.hash` inside the loaded renderer and waits for TanStack Router to process the change
- Build the app first (`pnpm --filter app build`), then run `pnpm test:e2e` (aliases `pnpm --filter @sproutgit/e2e test`)

### Selectors

- Prefer `data-testid` attributes for test targeting: `page.getByTestId('btn-create-worktree')`
- CSS class selectors `sg-*` are stable selectors for E2E (e.g., `.sg-worktree-btn`)
- Add `data-testid` and `sg-*` CSS classes when adding interactive UI elements

### Important worktree test IDs

| Element | `data-testid` |
|---|---|
| Create worktree button | `btn-open-create-worktree` |
| New branch input | `input-new-branch` |
| Confirm create button | `btn-create-worktree` |
| Worktree list item | `worktree-item` (also `data-branch`, `data-path`) |
| Confirm delete button | `btn-confirm-delete-worktree` |

---

## Build output

| Mode | Output |
|---|---|
| Dev | `app/out/` (electron-vite compiled, not packaged) |
| Production | `app/dist-electron/` (packaged app, e.g., `mac-arm64/SproutGit.app`) |
| electron-builder resources | `app/build/` (icon.icns, icon.png, entitlements) |

---

---

## Logging

The app uses **electron-log** for persistent structured logging across both processes.

- **Main process**: `log` is exported from `app/src/main/telemetry.ts` — use `log.info/warn/error()` instead of `console.*` for anything worth persisting.
- **Renderer process**: all `console.*` calls are automatically forwarded to the log file via the `console-message` event in `createWindow()`.
- **Log outputs to both console (dev) and file (always).**

### Log file locations

| Platform | Path |
|---|---|
| macOS | `~/Library/Logs/SproutGit/main.log` |
| Windows | `%APPDATA%\SproutGit\logs\main.log` |
| Linux | `~/.config/SproutGit/logs/main.log` |

### Tailing logs for diagnostics

```bash
# macOS/Linux — live tail during development
tail -f ~/Library/Logs/SproutGit/main.log
```

When diagnosing issues in a running app, tail the log in a separate terminal alongside `pnpm dev`. Renderer and main process output are interleaved with `[renderer]` prefix on renderer lines.

---

## Debugging with Electron MCP Server

The project uses **electron** - a local MCP tool for inspecting and debugging the running Electron app via Chrome DevTools Protocol.

### Required workflow for UI/renderer tasks

- For renderer bugs, visual regressions, Monaco/editor issues, context menu behavior, layout/resize bugs, and interaction bugs, use Electron MCP tools first.
- Validate fixes directly in the running app via MCP (inspect page structure, evaluate runtime state, and read console output) before asking for manual user verification.
- Do not stop at code edits alone when MCP validation is available.
- If MCP cannot be used (server unavailable, no running Electron target, or tool failure), explicitly state the blocker and then provide the minimal manual verification steps.

### Example Usage

1. Start the dev app: `pnpm dev`
2. Inspect page state, console logs, and execute commands directly via the MCP server

---

## CI / Linux E2E pipeline debugging

### Architecture constraints on Apple Silicon

Full E2E simulation on Apple Silicon (arm64 Mac) is **not feasible** locally:

- `act` with arm64 catthehacker images: wdio downloads an x86_64 Chromedriver → `rosetta error: failed to open elf at /lib64/ld-linux-x86-64.so.2`
- `act --container-architecture linux/amd64` (QEMU): act injects its own arm64 node into the amd64 container → `node: executable file not found in $PATH`
- Native arm64 Docker containers: Electron runs, but Chromedriver is always fetched as x86_64

**Definitive validation requires pushing to GitHub and letting the real `ubuntu-latest` (x86_64) runners execute the E2E suite.**

### Known Linux CI gotchas

- **D-Bus deadlock**: `autoUpdater.checkForUpdates()` in `electron-updater` makes a blocking D-Bus IPC call on Linux when the system D-Bus daemon is running (always present on `ubuntu-latest`). In E2E mode, this deadlocks the Electron main process before the renderer loads. **Fix**: guard `startUpdateCheck()` with `if (!isE2EMode)` in `app/src/main/index.ts`. The `isE2EMode` flag is set when `process.argv.includes('--sproutgit-e2e')`, which wdio passes when launching Electron.
- **Headless display**: Electron requires a display server on Linux. Wrap the E2E command with `xvfb-run --auto-servernum --server-args="-screen 0 1280x800x24"` and ensure `xvfb` is installed in the apt-get step.
- **Sandbox**: pass `--no-sandbox --disable-setuid-sandbox` to Electron in CI (already in `wdio.conf.ts`).

### Proving a Linux-specific hang locally (arm64 Docker)

To confirm whether a code path causes a main-process freeze on Linux with D-Bus present, use the cached `sproutgit-dbus-proof-arm64:latest` Docker image:

```bash
# Build the app inside the container, start Xvfb + D-Bus, run Electron for 5s,
# and check whether the renderer emitted any log lines.
docker run --rm \
  -v "$(pwd):/src:ro" \
  -v "/tmp/your-proof.sh:/proof.sh:ro" \
  sproutgit-dbus-proof-arm64:latest \
  bash /proof.sh
```

Key detection heuristic: after 5 seconds, if no `[renderer]` lines appear in the Electron log, the main process is frozen (D-Bus deadlock). If `[renderer]` lines appear, the app is alive.

The image already has: ubuntu 24.04, Node 22, pnpm, xvfb, dbus, all Electron system deps. Rebuild it with `docker build -t sproutgit-dbus-proof-arm64:latest .` from a Dockerfile that installs those deps if it becomes stale.

---

## Pull requests

Release notes are generated from PR descriptions. Always fill out [.github/PULL_REQUEST_TEMPLATE.md](../.github/PULL_REQUEST_TEMPLATE.md) completely when opening a PR:

- Pick the correct **Type** checkbox — it should match the Conventional Commits type used in the commit/PR title (`feat`, `fix`, `perf`, `chore`, `docs`, `refactor`).
- Write **Summary** bullets as release-note entries for end users (user-visible outcome, past tense) — not a description of the diff.
- Fill in **Screenshots / recordings** for any renderer/UI change; delete that section otherwise.
- State **Breaking changes** explicitly, even if "None".

## Common pitfalls

- **Don't import from `old/`** — it's the Tauri/SvelteKit source for reference only.
- **`node:sqlite` not `better-sqlite3`** — the Electron-bundled SQLite is used; `better-sqlite3` is stubbed out with `betterSqlite3Stub` in `electron.vite.config.ts`.
- **Hash router** — use TanStack Router's `useNavigate()` / link components; don't manipulate `window.location` directly except in non-React contexts.
- **Menu required on macOS** — always ensure `Menu.setApplicationMenu()` is called or clipboard shortcuts (Cmd+C/V/Z/X) will not work.
- **`app.addRecentDocument()`** — must be called whenever a workspace is opened to keep the macOS dock "Open Recent" and Windows jump list in sync.
