---
title: Writing hooks
description: Create a lifecycle hook through the Workspace Hooks UI, or hand-author a sproutgit.hooks.json for your repo.
---

See [Hooks & the trust model](/docs/concepts/hooks-and-trust/) first if
you're not yet familiar with the difference between local and repo hooks —
this guide covers authoring one either way.

## Through the UI (local hooks)

Open **Workspace Hooks** from the sidebar toolbar and click to create a new
hook. Each hook has:

- **Name** — e.g. "Install dependencies".
- **Scope** — `Worktree` (this hook only applies where it's relevant to a
  specific worktree action) or `Workspace` (applies workspace-wide).
- **Trigger** — one of `Before worktree create`, `After worktree create`,
  `Before worktree remove`, `After worktree remove`, `Before worktree
  switch`, `After worktree switch`, or `Manual` (run on demand, not tied to
  a lifecycle event).
- **Execution target** — `Trigger worktree`, `Initiating worktree`, or
  `Workspace root` — which directory the script actually runs in.
- **Shell** — `bash`, `zsh`, `pwsh`, or `powershell`.
- **Script** — the shell script body.
- **Timeout (seconds)** — how long the hook may run before SproutGit kills
  it.

Additional toggles let you mark a hook **critical** (a failure blocks the
lifecycle action rather than just being reported), run it **once per
session**, restrict switch hooks to only fire **on worktree create** or
**on worktree delete**, and **keep the terminal open** after the script
finishes instead of closing it automatically.

You can also set **dependencies** — other hooks (in the same file) that
must run first. This lets you split, say, "install deps" and "start dev
server" into two hooks where the second waits on the first.

Local hooks you create this way are always trusted immediately — nothing
external wrote them, so there's no trust decision to make.

## Runtime variables

Your script can reference these environment variables, populated per run:

| Group | Variables |
|---|---|
| Workspace | `$SPROUTGIT_WORKSPACE`, `$SPROUTGIT_WORKSPACE_NAME`, `$SPROUTGIT_ROOT_PATH`, `$SPROUTGIT_WORKTREES_PATH` |
| Worktree | `$SPROUTGIT_WORKTREE`, `$SPROUTGIT_WORKTREE_NAME`, `$SPROUTGIT_WORKTREE_BRANCH`, `$SPROUTGIT_SOURCE_REF` |
| Trigger | `$SPROUTGIT_TRIGGER`, `$SPROUTGIT_INITIATING_WORKTREE` |
| Hook | `$SPROUTGIT_HOOK_ID`, `$SPROUTGIT_HOOK_NAME`, `$SPROUTGIT_HOOK_SCOPE`, `$SPROUTGIT_HOOK_SHELL`, `$SPROUTGIT_HOOK_CRITICAL`, `$SPROUTGIT_HOOK_TIMEOUT_SECONDS` |
| System | `$SPROUTGIT_OS` |

A typical "after worktree create" hook script:

```sh
cd "$SPROUTGIT_WORKTREE"
pnpm install
pnpm build
```

## Shipping hooks with your repo

To give everyone who clones the repo the same hooks (rather than each
person configuring their own local ones), commit a `sproutgit.hooks.json`
file at the root of your **worktree's working copy** — not inside
`.sproutgit/`:

```json
{
  "version": 1,
  "hooks": [
    {
      "name": "Install dependencies",
      "trigger": "after_worktree_create",
      "executionTarget": "trigger_worktree",
      "shell": "bash",
      "script": "pnpm install"
    },
    {
      "name": "Type check",
      "trigger": "after_worktree_create",
      "executionTarget": "trigger_worktree",
      "shell": "bash",
      "script": "pnpm typecheck",
      "dependsOn": ["Install dependencies"]
    }
  ]
}
```

This file is **read-only from the app** — the UI shows it with a "repo"
badge and a lock icon; to change a repo hook, edit the file and commit, the
same as any other tracked file. Anyone who pulls the new commit sees the
updated hook — but each of *their* hooks still needs to be individually
trusted before it runs, per
[the trust model](/docs/concepts/hooks-and-trust/#why-repo-hooks-need-trust).

`dependsOn` references hooks by `name`, and only within the same file — a
repo hook can't depend on a local hook or vice versa.

## Running a hook manually

Any hook with a `Manual` trigger (or any hook at all, via the hooks list)
can be run on demand rather than waiting for its lifecycle event — useful
for one-off maintenance scripts you don't want firing on every switch.
