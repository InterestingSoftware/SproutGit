# SproutGit — Improvement Ideas

> Brainstorm from a codebase review on 2026-07-06. Grouped by area; each idea tagged
> ⭐ (high leverage), 🔧 (solid improvement), or 💡 (speculative). Prune freely.

## UX

- ⭐ **Onboard the worktree-first mental model.** Worktree-first is SproutGit's core differentiator, but it's an unfamiliar concept for most Git GUI users. Add a first-run walkthrough on the home screen (create workspace → create worktree → launch agent) and empty states that teach instead of just sitting blank.
- ⭐ **Worktree status at a glance in the sidebar.** Show ahead/behind counts, dirty-file count, and last-commit age on each `worktree-item`, not just the live-agent badge. The sidebar is the app's home base; it should answer "which worktree needs my attention?" without clicking through.
- ⭐ **Hunk- and line-level staging.** Staging is currently file-level only. Partial staging is table stakes for a Git GUI and pairs naturally with reviewing AI-generated diffs ("keep this hunk, discard that one").
- 🔧 **Command palette (Cmd+K).** Jump to worktree, create worktree, launch agent, open settings. Keyboard-heavy users (the target audience) will expect it, and it scales better than adding more toolbar icons.
- 🔧 **Merge-conflict resolution UI.** The moment two agents' branches collide is exactly when SproutGit should shine. Even a minimal three-pane view in the existing Monaco editor beats bouncing to an external merge tool.
- 🔧 **Notification when a background agent finishes.** Users will run agents in several worktrees at once; an OS notification (or badge pulse) when a session goes idle closes the loop. `TerminalManager` already knows session liveness.
- 🔧 **Undo for destructive actions.** Back worktree/branch deletion with reflog so "Delete worktree" can offer a toast-level Undo instead of a scary confirm dialog.
- 💡 **"Bring branch home" flow.** A one-click action on a worktree: rebase/merge onto main, or open a PR — the natural end of every worktree's lifecycle, currently left to the terminal.

## Featureset

- ⭐ **PR integration.** GitHub OAuth already exists (`packages/providers/github`). Show PR + checks status per worktree in the sidebar, and add "Create PR from this worktree." This turns the sidebar into an agent-work review queue — very on-brand.
- ⭐ **Agent session dashboard.** There's a live-session badge; go further: a panel listing all running agent sessions across worktrees with status, elapsed time, and a jump-to-terminal button. This is the "mission control for parallel agents" story made concrete.
- 🔧 **Stash, cherry-pick, and interactive-rebase basics.** Cherry-pick from the commit graph context menu is a cheap win given the graph already exists.
- 🔧 **Worktree creation presets.** Post-create hooks exist; add presets for the common pain points — copy `.env` files, run `pnpm install`, symlink shared caches — so a fresh worktree is instantly runnable. This is the #1 real-world friction with worktrees.
- 🔧 **Expand and document the MCP server** (`packages/mcp-server`). Tools like "list worktrees," "create worktree for task X," "report session done" let external agents drive SproutGit — a moat no classic Git GUI has.
- 🔧 **GitLab / Bitbucket providers.** `packages/providers/` is already shaped for it; even read-only clone support widens the funnel.
- 💡 **Cross-worktree search.** "Which worktree touched `ipc.ts`?" — grep across all worktrees from one box.
- 💡 **Commit signing (SSH/GPG) and git-lfs awareness.** Needed before teams at larger orgs can adopt.

## Documentation

- ⭐ **User docs are currently zero.** `docs/` contains only `agent-instructions.md` (for LLMs). Add a user guide: getting started, the worktree-first concept, hooks reference, agent setup per tool (Claude Code, Codex, Gemini, Cursor), MCP server reference. Astro Starlight slots straight into the existing `website/`.
- 🔧 **Publish release notes.** PR descriptions are already written as release-note entries — surface them on the website and in the in-app updater dialog ("What's new").
- 🔧 **In-app help affordances.** Link dialogs (hooks, agents, MCP settings) to their doc pages; a `?` icon beats a support ticket.
- 🔧 **ADRs for the decisions already made.** Bare-root migration, `node:sqlite` over `better-sqlite3`, hash router, ACP chat backend — these are documented ad hoc in agent-instructions; short ADRs make them durable for human contributors too.

## Best practices

- ⭐ **macOS code signing + notarization.** Issue #63 (auto-update flicker from unsigned builds) is a symptom; unsigned builds also mean Gatekeeper warnings that kill adoption at download time. Prioritize signing certs for mac and Windows before any marketing push.
- 🔧 **Validate IPC payloads at the boundary.** The security rules mandate path validation; enforce it systematically with zod schemas per channel in `app/src/main/ipc/` rather than per-handler discipline.
- 🔧 **Electron hardening pass.** Add a CSP to the renderer, flip Electron fuses (`runAsNode` off, etc.), and add `pnpm audit` / dependency-review to CI.
- 🔧 **Formalize opt-in error telemetry.** `error-reporting.ts` and the crash safety net (#65) exist; add an explicit opt-in toggle in settings and a privacy note, so crash reports can actually be collected.
- 🔧 **Accessibility pass on dialogs and sidebar.** Focus traps, ARIA roles, and full keyboard navigation — cheap now, expensive after the UI surface grows.

## Performance

- ⭐ **Virtualize the commit graph and paginate `git log`.** Large repos (100k+ commits) are the obvious first performance cliff for any Git GUI; incremental log loading plus list virtualization prevents it.
- 🔧 **Lazy-load Monaco and code-split routes.** Monaco is the heaviest renderer dependency and most sessions never open the file editor; dynamic-import it to cut startup time and memory.
- 🔧 **Batch git status work.** `simple-git` spawns a process per call; with many worktrees, watcher-triggered refreshes multiply. Debounce per-worktree, and consider one status sweep for the sidebar rather than N parallel spawns.
- 🔧 **xterm WebGL renderer + scrollback caps.** The buffer-leak fix landed; the WebGL addon makes long agent sessions noticeably smoother.
- 💡 **Measure before optimizing further:** log startup time-to-interactive and status-refresh duration via electron-log so regressions show up in real usage.

## Dev experience

- ⭐ **Split `workspace.tsx` (1,578 lines).** It dwarfs every other renderer file and is where most feature work lands, so it's the highest-friction file in the repo. Extract panels, dialogs wiring, and data hooks; also decompose `WorktreeSidebar.tsx` (474 lines) while at it.
- 🔧 **Land the knip worktree.** Dead-export detection pays off fast in a monorepo with seven packages (an `add-knip` worktree already exists — finish it).
- 🔧 **Cross-platform E2E in CI.** The Linux D-Bus/xvfb battle is documented; add macOS and Windows runners to the matrix so platform regressions (Windows lock-file races, #53) get caught pre-merge.
- 🔧 **Component workbench for `@sproutgit/ui`.** Ladle or Storybook for CommitGraph, dialogs, and toasts — faster iteration than booting Electron for every visual tweak.
- 💡 **Contributor funnel.** Issue templates, `good first issue` labels, and a CONTRIBUTING section on using SproutGit to develop SproutGit (dogfooding is already the workflow — say so).

## Marketing

- ⭐ **Build the landing page — it's currently a 19-line stub.** The pitch writes itself: *"The Git client for the agent era — give every AI agent its own worktree."* The `hero-screenshots.spec.ts` E2E already automates screenshot capture; pipe those straight into the site so visuals never go stale.
- ⭐ **Demo GIF of the killer workflow.** Three worktrees, three Claude Code sessions running in parallel, diffs reviewed and merged from one window. Put it at the top of the README and the site; it's the whole value prop in 20 seconds.
- 🔧 **Distribution channels.** Homebrew cask, winget, and Flatpak/AUR listings — low effort, and where the target audience actually installs from.
- 🔧 **Launch content.** Show HN + Product Hunt once signing lands; blog posts with legs: "Why worktrees beat branches for AI-assisted development," "Running five coding agents on one repo without them fighting."
- 🔧 **Comparison content.** Honest pages vs GitButler, GitKraken, Fork, Tower — search traffic for "X alternative" converts, and "worktree-first + agent-native" is a clean differentiator none of them claim.
- 💡 **Integration guides as marketing.** "SproutGit + Claude Code," "+ Codex CLI," "+ Gemini CLI" setup guides double as SEO and as docs; each agent's community is a distribution channel.

## Suggested sequencing

1. **Adoption blockers first:** code signing, landing page + demo GIF, getting-started docs.
2. **Differentiators second:** agent dashboard, PR-per-worktree, worktree presets, MCP docs.
3. **Table stakes third:** hunk staging, conflict UI, stash/cherry-pick, graph virtualization.
4. **Continuous:** split `workspace.tsx`, IPC validation, E2E matrix.
