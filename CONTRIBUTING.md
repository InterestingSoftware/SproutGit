# Contributing to SproutGit

Thanks for your interest in contributing!

> **Note:** SproutGit is an early prototype under active development. This is a great time to shape the direction of the project.

---

## Prerequisites

- **Node.js** ≥ 22
- **pnpm** v11 (`npm install -g pnpm`)
- **Git** ≥ 2.36 (worktree support required)

## Getting Started

```bash
# 1. Fork and clone
git clone https://github.com/your-fork/sproutgit.git
cd sproutgit

# 2. Install dependencies (all packages in the monorepo)
pnpm install

# 3. Start the app in dev mode with hot-reload
pnpm dev
```

## Common Commands

```bash
pnpm dev              # Start Electron app with hot-reload (electron-vite)
pnpm build            # Production build → app/dist-electron/
pnpm typecheck        # TypeScript typecheck across all packages
pnpm lint             # oxlint
pnpm test             # Unit tests (Vitest)
pnpm test:e2e         # WebdriverIO E2E tests (requires a production build first)
```

---

## Monorepo Structure

```
app/                  ← Electron app (main process + renderer + preload)
packages/
  types/              ← Shared TypeScript types + all IPC channel constants
  git/                ← simple-git wrapper — all Git operations live here
  database/           ← Drizzle ORM + node:sqlite — config DB and workspace DB
  terminal/           ← node-pty wrapper
  ui/                 ← Shared React components
  providers/github/   ← GitHub provider integration (OAuth, repo listing)
e2e/                  ← WebdriverIO end-to-end tests
website/              ← Astro marketing site
old/                  ← Legacy Tauri/SvelteKit source — do NOT modify
```

---

## Coding Conventions

### TypeScript / React

- **React 19** with hooks. No class components.
- **TanStack Router v1** with `createHashHistory()` — use `useNavigate()` and `<Link>`, never manipulate `window.location` directly from React components.
- **Zustand v5** for cross-component state. TanStack Query for all server/IPC-fetched data.
- **Tailwind CSS v4** — utility classes only, no config file. Use `--sg-*` CSS variables from `app/src/renderer/tailwind.css` for all colors and spacing tokens. Never hardcode color values.
- **Icons** — `lucide-react` only. Do not add new icon libraries or use emoji as icons.
- Use `cn()` (re-exported from `@sproutgit/ui`) for conditional class names.

### IPC — adding a new call

All IPC channel names live in `packages/types/src/ipc.ts`. Never use bare strings.

1. Add `IPC.DOMAIN_ACTION: 'domain:action'` to `packages/types/src/ipc.ts` and its entry to `IpcMap`.
2. `pnpm --filter @sproutgit/types build`
3. Add the handler in `app/src/main/ipc/<domain>.ts`.
4. Expose it via `window.api` in `app/src/preload/index.ts`.
5. Call `window.api.myNewCall()` from the renderer — never import `ipcRenderer` in renderer code.

### Database — adding or changing a schema

The database package has two schemas: `config` (global user settings) and `workspace` (per-repo state). Both use Drizzle ORM with `node:sqlite`.

**Always generate migrations with drizzle-kit — never write migration SQL by hand.**

Config schema changes:
```bash
cd packages/database
pnpm drizzle-kit generate --config=drizzle.config.config.ts
```

Workspace schema changes:
```bash
cd packages/database
pnpm drizzle-kit generate --config=drizzle.workspace.config.ts
```

Then rebuild the package:
```bash
pnpm --filter @sproutgit/database build
```

### Git operations

All Git work goes through `@sproutgit/git`. Do not call `simple-git` directly from the main process or use `child_process`/`exec` for Git commands.

### Security

- `nodeIntegration: false` and `contextIsolation: true` — never change these.
- All Node.js access goes through the context bridge (`window.api`).
- Validate paths received over IPC before passing to filesystem APIs.
- Use `simple-git` APIs for Git operations — never pass user input to shell commands.

---

## Adding a New Feature — Checklist

1. **Types** — Add shared types to `packages/types/src/` and rebuild: `pnpm --filter @sproutgit/types build`
2. **IPC** — Follow the IPC steps above if the feature needs main ↔ renderer communication
3. **Main process** — Implement in `app/src/main/ipc/<domain>.ts`, delegating to the appropriate package
4. **Renderer** — Build UI using existing design tokens and component patterns
5. **Tests** — Add unit tests for business logic; add E2E selectors (`data-testid`) for any new interactive elements
6. **Verify** — `pnpm typecheck && pnpm lint && pnpm test`

---

## Submitting Changes

1. Create a branch from `main`
2. Make focused commits — one feature or fix per PR
3. Run `pnpm typecheck && pnpm lint && pnpm test` before pushing
4. Open a pull request against `main` with a clear description of what changed and why

## Reporting Issues

- Use GitHub Issues
- Include your OS, Node version, Git version, and steps to reproduce
- Attach relevant error messages or screenshots from `~/Library/Logs/SproutGit/main.log` (macOS) / `%APPDATA%\SproutGit\logs\main.log` (Windows)
