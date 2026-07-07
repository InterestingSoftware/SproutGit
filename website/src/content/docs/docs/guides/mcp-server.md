---
title: Using the MCP server
description: Expose a workspace to MCP-capable agents over a token-protected local HTTP endpoint.
---

Every open workspace can run its own [MCP](https://modelcontextprotocol.io)
(Model Context Protocol) server, letting any MCP-capable agent — not just
the one you've configured as your default coding agent — list worktrees,
check status and diffs, report a finished session, and (once enabled)
create or remove worktrees, directly through its own tool-calling interface.

## Enabling it

Open **Settings → MCP Server** with a workspace open, and toggle **Enable
for this workspace**. Once running, the panel shows the live endpoint:

```
http://127.0.0.1:<port>/mcp
```

The port defaults to a value derived from your workspace path, so it stays
stable across app restarts (and won't collide with another open workspace's
server) — you can override it in the **Port** field if something else on
your machine is already using the default.

## Security model

The server only binds to `127.0.0.1` — it's never reachable from the
network. Since a loopback TCP port (unlike a Unix socket) is still reachable
by *any* process on your machine regardless of user, every request also
needs a per-workspace bearer token in an `Authorization: Bearer <token>`
header. The `Host` header is validated too, which defeats DNS-rebinding
attacks from a malicious webpage trying to reach it through your browser.

## Connecting a client

Click a client's button under **Connect an agent** to have SproutGit write
its connection details directly into that client's config:

| Client | Config file written |
|---|---|
| Claude Code | `.mcp.json` (workspace root) |
| Cursor | `.cursor/mcp.json` (workspace root) |
| Kiro | `.kiro/settings/mcp.json` (workspace root) |
| Gemini CLI | `~/.gemini/settings.json` (user-level) |
| Codex CLI | `~/.codex/config.toml` (user-level) |

Gemini and Codex configs are user-level rather than per-workspace, so
SproutGit names the server entry `sproutgit-<workspace-folder-name>` to
avoid collisions if you have more than one workspace connected at once.

For any other MCP client, use **Copy manual config** to copy a ready-made
JSON (or TOML, for Codex-style clients) snippet with the URL and auth header
already filled in, and paste it into that client's own config file.

## Available tools

| Tool | What it does |
|---|---|
| `list_worktrees` | Lists every git worktree in the workspace, including branch, HEAD, and whether it's externally managed. |
| `get_workspace_info` | Returns the workspace root, git repo path, managed worktrees path, and worktree count. |
| `get_worktree_status` | Returns staged/unstaged/untracked files for one worktree (must be one already returned by `list_worktrees`). |
| `get_worktree_diff` | Returns the unified diff of a worktree's working tree (staged + unstaged) against `HEAD`, optionally scoped to one file. |
| `report_session_done` | Tells SproutGit the agent finished a session of work in a worktree, with an optional summary — shown to the user as a toast in that workspace. |
| `create_worktree` | Creates a new managed worktree from a ref. |
| `remove_worktree` | Removes a managed worktree, optionally deleting its branch. |
| `list_hooks` | Lists effective [hooks](/docs/guides/writing-hooks/) (local + repo, merged) for a worktree, with source, trigger, enabled, and trusted state. |
| `list_hook_runs` | Reads the hook-run audit log for a worktree, most recent first — useful for diagnosing why a worktree didn't get set up correctly. |
| `create_local_hook` / `update_local_hook` / `delete_local_hook` / `toggle_local_hook` | Create, edit, delete, or enable/disable a **local** hook (`.sproutgit/local-hooks.json`, this machine only). |
| `run_hook` | Triggers a hook run for a worktree, the same way the Run Hook dialog does, and returns the result. |

`create_worktree` and `remove_worktree` go through the exact same code path
as creating/removing a worktree from the UI — including running any
[hooks](/docs/guides/writing-hooks/) configured for that lifecycle event.

:::note
`create_worktree`, `remove_worktree`, the local-hook write tools, and
`run_hook` are **currently disabled for every workspace, with no way to turn
them on yet** — there's no permission-gate setting for them in the app yet,
so they unconditionally refuse. Every other tool (`list_worktrees`,
`get_workspace_info`, `get_worktree_status`, `get_worktree_diff`,
`report_session_done`, `list_hooks`, `list_hook_runs`) always works once the
server is enabled — none of them mutate git, filesystem, or hook state, so
none are gated behind that same permission.
:::

:::note
Repo-tracked hooks (`sproutgit.hooks.json`) stay **read-only** through
MCP — `list_hooks` shows them, but there's no tool to create, edit, or
delete one (edit the file and commit, same as in the app). There's also no
MCP tool to grant a repo hook trust: trusting one is always a manual
decision you make in the app, since the hook's script arrived via `git
checkout`. `run_hook` refuses to run a repo hook that isn't trusted yet, for
the same reason.
:::

![MCP server settings](../../../../assets/screenshots/mac/settings/preferences-light.png)
