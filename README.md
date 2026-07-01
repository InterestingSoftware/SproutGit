<p align="center">
  <img src="logos/logo Exports/logo-iOS-Default-1024x1024@1x.png" width="80" alt="SproutGit logo" />
</p>

<h1 align="center">SproutGit</h1>

<p align="center">
  A fast, open-source, cross-platform Git desktop app with a <strong>worktree-first</strong> workflow.<br/>
  Optimized for AI-driven software development.<br/>
  Built with <a href="https://www.electronjs.org">Electron v43</a> · <a href="https://react.dev">React 19</a> · <a href="https://www.typescriptlang.org">TypeScript</a>
</p>

<p align="center">
  <a href="#features">Features</a> ·
  <a href="#why-worktree-first">Why worktree-first?</a> ·
  <a href="#architecture">Architecture</a> ·
  <a href="#development">Development</a> ·
  <a href="#building">Building</a> ·
  <a href="#testing">Testing</a> ·
  <a href="#contributing">Contributing</a> ·
  <a href="#license">License</a>
</p>

---

> [!NOTE]
> **This is an AI-assisted development project.** Much of the implementation is written by LLMs under our direction. We plan architecture and execution manually, review all outputs carefully, and hold the work to normal engineering standards.

> [!WARNING]
> **SproutGit is an early prototype.** It is under active development and not ready for regular use. Expect missing features, rough edges, and breaking changes.

## Why worktree-first?

Most Git GUIs treat branches as the primary unit of work. SproutGit treats **worktrees** as first-class citizens instead.

A Git worktree is a separate working directory linked to the same repository. Unlike branches — which are just pointers — worktrees give you a real, independent directory for each piece of work: no stashing, no context-switching, no losing your place.

This matters especially with AI agents. Each agent gets its own isolated directory while sharing the same repository. Traditional branch workflows break down here because agents fight over the same working directory.

## Features

- **Worktree management** — create, switch, and delete managed worktrees from a clean sidebar
- **External worktree support** — worktrees registered by other tools (e.g. an AI agent's own `git worktree add`) are adopted automatically, shown alongside managed worktrees with a distinct icon, and fully usable for terminals, diffs, hooks, and agent launches; removing one never deletes its branch
- **Commit graph** — visual branch history with diff viewer
- **Staging & commits** — file-level staging, commit message editor
- **AI commit-message generation** — optional "magic" button that runs a configured command (built-in presets for Claude Code, Kiro, Codex, Gemini, or a custom command) against the staged diff and recent commit history to draft a message
- **AI coding agents** — launch a configured coding agent (Claude Code, Kiro, Cursor, Codex CLI, Gemini CLI, or a custom command) as a terminal session scoped to any worktree, tagged with a live-session badge
- **Hooks** — per-workspace lifecycle hooks (pre-switch, post-switch, etc.) with a progress overlay; adopted external worktrees can opt in via a "Run Create Hooks…" action
- **Integrated terminal** — persistent per-worktree terminal sessions
- **GitHub integration** — clone from GitHub repos, device-flow OAuth
- **Auto-update** — built-in update checker via electron-updater
- **Cross-platform** — macOS (arm64 + x64), Windows (x64), Linux (x64)

## Architecture

### Monorepo layout

```
sproutgit/
├── app/                        ← Electron app (main + renderer)
│   ├── src/
│   │   ├── main/               ← Node.js main process
│   │   │   └── ipc/            ← IPC handlers (git, workspace, terminal, …)
│   │   ├── preload/            ← Context-bridge (exposes window.api)
│   │   └── renderer/           ← React UI
│   │       ├── routes/         ← TanStack Router pages (index, workspace, settings)
│   │       ├── workspace/      ← Workspace-specific components & dialogs
│   │       ├── stores/         ← Zustand stores
│   │       └── settings/       ← Settings panel sections
│   ├── build/                  ← electron-builder resources (icons, entitlements)
│   └── out/                    ← Compiled output (git-ignored)
├── packages/
│   ├── git/                    ← Pure TypeScript git wrapper (simple-git)
│   ├── terminal/               ← PTY management (node-pty)
│   ├── database/               ← Drizzle ORM + node:sqlite (config DB + workspace DB)
│   ├── types/                  ← Shared TypeScript types + IPC channel constants
│   ├── ui/                     ← Shared React components (WindowControls, CommitGraph, …)
│   ├── providers/github/       ← GitHub provider integration (OAuth, repo listing)
│   └── ts-config/              ← Shared tsconfig bases
├── e2e/                        ← WebdriverIO end-to-end tests
└── website/                    ← Astro marketing site
```

### Stack

| Layer | Technology |
|---|---|
| Desktop shell | Electron v43 |
| Renderer | React 19 + TanStack Router v1 (hash history) |
| Styling | Tailwind CSS v4 (`@tailwindcss/vite`) |
| State | Zustand v5 |
| Build | electron-vite v5 + electron-builder v26 |
| Monorepo | pnpm v11 workspaces + Turborepo v2 |
| Git | `@sproutgit/git` package wrapping simple-git |
| Terminal | `@sproutgit/terminal` wrapping node-pty |
| Database | `@sproutgit/database` — Drizzle ORM over `node:sqlite` (built into Electron 32+) |
| Types / IPC | `@sproutgit/types` — all IPC channel names live here |
| UI components | `@sproutgit/ui` — shared React components |

### Key design decisions

- **IPC is the boundary.** All Node.js/system access lives in `app/src/main/ipc/`. The renderer talks exclusively through `window.api` (the context bridge).
- **`node:sqlite` not `better-sqlite3`.** Electron ships a built-in SQLite since v32; no native binaries required.
- **Hash router.** TanStack Router uses `createHashHistory()` because the renderer is served from a `file://` URL.
- **Workspace layout.** Each SproutGit workspace lives at a directory containing `.sproutgit/root` (bare repo), `.sproutgit/worktrees/` (managed worktrees), and `.sproutgit/state.db` (SQLite).

## Development

### Prerequisites

- **Node.js ≥ 22**
- **pnpm 11** (`npm install -g pnpm`)
- **Git**

### Install

```sh
pnpm install
```

### Run in development

```sh
pnpm dev
```

Turborepo builds all packages in dependency order, then starts `electron-vite dev` with hot reload.

### Typecheck

```sh
pnpm typecheck
```

### Lint

```sh
pnpm lint
```

## Building

### macOS (produces `.dmg` + `.zip` for arm64 and x64)

```sh
pnpm --filter app dist:mac
# or from app/ directory:
pnpm dist:mac
```

Output: `app/dist-electron/mac-arm64/SproutGit.app`

### Windows (produces NSIS installer)

```sh
pnpm --filter app dist:win
```

### Linux (produces AppImage + .deb)

```sh
pnpm --filter app dist:linux
```

## Testing

### Unit tests

```sh
pnpm test
```

Tests live alongside the packages they test (e.g., `packages/git/src/__tests__/`).

### E2E tests (WebdriverIO + Electron)

```sh
# Build the app first (E2E runs against compiled output)
pnpm --filter app build

# Run all E2E specs
pnpm test:e2e
```

E2E specs use WebdriverIO (`e2e/wdio.conf.ts`) with `wdio-electron-service`, launching the real Electron binary and driving it via WebDriver. Shared helpers live in `e2e/helpers.ts` — plain async functions such as `gotoHash('/route?param=value')` and `goHome()` (using the WDIO globals `browser`/`$`/`expect`), not a Playwright-style fixture.

## Contributing

1. Fork and clone
2. `pnpm install`
3. Create a worktree for your change: use SproutGit itself, or `git worktree add ../my-feature -b feature/my-feature`
4. Make your change with tests
5. `pnpm lint && pnpm typecheck && pnpm test`
6. Open a PR

Pre-commit hooks run lint + typecheck + unit tests automatically.

## License

MIT — see [LICENSE](LICENSE)
