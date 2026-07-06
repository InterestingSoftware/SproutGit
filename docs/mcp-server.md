# MCP Server (`packages/mcp-server`)

SproutGit exposes each open workspace to [MCP](https://modelcontextprotocol.io)-capable
agents (Claude Code, Gemini CLI, Codex CLI, Cursor, Kiro, or any other MCP
client) over a local, token-protected HTTP endpoint. This lets an external
agent see and drive the same worktrees you're working in, instead of shelling
out to raw `git` and guessing at SproutGit's on-disk layout.

## Enabling it

In the app: **Settings → MCP Server** (per workspace).

- Toggle **Enable for this workspace** — starts an HTTP server bound to
  `127.0.0.1` on a port that's stable across app restarts (derived
  deterministically from the workspace path, overridable in the same panel).
- **Connect an agent** writes the connection (URL + bearer token) straight
  into a client's own MCP config file, or **Copy manual config** gives you a
  snippet for any client not in that list.
- Endpoint: `http://127.0.0.1:<port>/mcp`, `POST` only (Streamable HTTP
  transport, stateless — one request in, one response out). Every request
  needs `Authorization: Bearer <token>`; the token and port are per-workspace
  and shown in the Settings panel.

Two layers of protection since this binds a loopback TCP port rather than a
Unix socket: the SDK validates the `Host` header (defeats DNS-rebinding from
a malicious webpage), and the bearer token defends against other local
processes on the same machine (a loopback port, unlike a Unix socket, is
reachable by any process regardless of which user owns it).

## Tools

All read-only tools and `report_session_done` are always available once the
server is enabled. `create_worktree` and `remove_worktree` are implemented
but **refuse every call by default** — there's no Settings UI yet to opt a
workspace into mutating tools, so they currently always return an error
explaining that. This is a temporary default, not a capability gap.

### `list_worktrees`

Lists every git worktree in the workspace.

No parameters.

Returns an array of:

```ts
{ path: string; head: string | null; branch: string | null; detached: boolean; isExternal: boolean }
```

`isExternal` is true for a worktree registered outside SproutGit's managed
worktrees directory (e.g. one another tool created).

### `get_workspace_info`

Returns the workspace's root paths and worktree count — useful as a first
call to orient an agent that just connected.

No parameters.

```ts
{ workspacePath: string; gitRepoPath: string; managedWorktreesPath: string; worktreeCount: number }
```

### `get_worktree_status`

Working-tree status (staged/unstaged/untracked files) for one worktree.

| Parameter | Type | Required | Description |
|---|---|---|---|
| `worktreePath` | string | yes | Absolute path of the worktree, as returned by `list_worktrees`. |

```ts
{
  worktreePath: string;
  files: Array<{
    path: string;
    originalPath: string | null; // set for renames
    staged: boolean;
    status: string;
    indexStatus: string;   // raw porcelain index-status character
    workTreeStatus: string; // raw porcelain work-tree-status character
  }>;
}
```

Rejects any `worktreePath` that isn't one of the paths `list_worktrees`
itself just reported for this workspace — call that first.

### `get_worktree_diff`

Unified diff of a worktree's current working tree (staged + unstaged changes)
against `HEAD`, optionally scoped to one file. Useful for an agent to review
its own changes before reporting a session done.

| Parameter | Type | Required | Description |
|---|---|---|---|
| `worktreePath` | string | yes | Absolute path of the worktree, as returned by `list_worktrees`. |
| `filePath` | string | no | Restrict the diff to this file, relative to the worktree root. Omit for the full diff. |

```ts
{ commit: 'WORKING'; base: 'HEAD'; filePath: string | null; diff: string }
```

Same `worktreePath` validation as `get_worktree_status`.

### `report_session_done`

Tells SproutGit that the calling agent has finished a session of work in a
worktree, so the app can surface it to the user — currently a toast in the
workspace UI (e.g. "feature-x: Implemented the feature"). Purely
informational: it doesn't touch git or the filesystem, so unlike
`create_worktree`/`remove_worktree` it is **not** gated behind the mutating-
tools permission and always runs.

| Parameter | Type | Required | Description |
|---|---|---|---|
| `worktreePath` | string | yes | Absolute path of the worktree the session ran in, as returned by `list_worktrees`. |
| `summary` | string | no | Free-text summary of what the session did. |

```ts
{ acknowledged: true; worktreePath: string }
```

If no SproutGit window is currently open for the workspace, the call still
succeeds — the notification is simply dropped, the same as other best-effort
main-process pushes to the renderer.

### `create_worktree` — disabled by default

Creates a new managed worktree branching from a ref.

| Parameter | Type | Required | Description |
|---|---|---|---|
| `newBranch` | string | yes | Name of the new branch to create. |
| `fromRef` | string | no (default `HEAD`) | Ref to branch from, e.g. `main` or `HEAD`. |

```ts
{ worktreePath: string; branch: string; fromRef: string }
```

Runs through the exact same code path as creating a worktree from the UI
(`app/src/main/worktree-lifecycle.ts`), so `before_worktree_create`/
`after_worktree_create` hooks and provenance recording run identically.

### `remove_worktree` — disabled by default

Removes a managed worktree, optionally deleting its branch.

| Parameter | Type | Required | Description |
|---|---|---|---|
| `worktreePath` | string | yes | Absolute path of the worktree to remove, as returned by `list_worktrees`. |
| `deleteBranch` | boolean | no (default `false`) | Also delete the worktree's branch. Requires `branchName`. |
| `branchName` | string | required if `deleteBranch` is true | Branch name to delete. |

```ts
{ removed: string; deleteBranch: boolean; branchName: string | null }
```

Same hook/provenance behavior as `create_worktree`, via
`removeWorktreeWithHooks`.

## Example: a Claude Code session

Once the workspace's MCP server is enabled and Claude Code's config has been
written from Settings, a session in that workspace can:

```
> list_worktrees
[{ "path": "/repo/.sproutgit/worktrees/feat-x", "branch": "feat-x", ... }]

> get_worktree_diff { "worktreePath": "/repo/.sproutgit/worktrees/feat-x" }
{ "commit": "WORKING", "base": "HEAD", "filePath": null, "diff": "diff --git a/..." }

> report_session_done { "worktreePath": "/repo/.sproutgit/worktrees/feat-x", "summary": "Added the retry logic and tests" }
{ "acknowledged": true, "worktreePath": "/repo/.sproutgit/worktrees/feat-x" }
```

The last call surfaces a toast in the SproutGit UI for whoever has that
workspace open, without the agent needing any other channel back to the user.

## Source layout

| File | Purpose |
|---|---|
| `packages/mcp-server/src/context.ts` | `McpServerContext` — everything a tool handler needs (workspace paths, the mutating-tools gate, and the injected `createWorktree`/`removeWorktree`/`reportSessionDone` callbacks). |
| `packages/mcp-server/src/tools.ts` | Tool handlers (exported standalone for unit testing) and `registerTools()`, which wires them onto a real `McpServer`. |
| `packages/mcp-server/src/server.ts` | `createMcpServer()` — builds one `McpServer` per accepted connection. |
| `packages/mcp-server/src/http-server.ts` | `createHttpApp()` — Express app serving `/mcp`: Host-header validation, bearer-token auth, Streamable HTTP transport. |
| `app/src/main/mcp-bridge.ts` | Owns the per-workspace HTTP server lifecycle in the real app; supplies the real `McpServerContext` (wired to `worktree-lifecycle.ts` and to the renderer window for `report_session_done`). |
| `app/src/main/ipc/mcp.ts` | IPC handlers backing the Settings UI (status, enable/disable, port, write client config, manual snippet). |

Adding a new tool: add a handler + Zod input schema in `tools.ts`, register it
in `registerTools()`, extend `McpServerContext` if it needs a new capability
from the host app, wire that capability in `mcp-bridge.ts`, and add tests in
`packages/mcp-server/src/__tests__/tools.test.ts` (handler-level) and/or
`app/src/main/__tests__/mcp-bridge.test.ts` (end-to-end over HTTP).
