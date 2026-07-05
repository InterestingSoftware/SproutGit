/**
 * Everything a tool handler needs to know about the workspace it's running
 * against. One context is created per open workspace and shared by every
 * tool call made against that workspace's MCP server.
 */
export type McpServerContext = {
  workspacePath: string;
  /** Always the bare repo at `<workspacePath>/.sproutgit/root`. */
  gitRepoPath: string;
  /** `<workspacePath>/.sproutgit/worktrees` — where managed worktrees live. */
  managedWorktreesPath: string;
  /**
   * Gate for the mutating tools (`create_worktree`, `remove_worktree`).
   *
   * TODO: this always returns `false` until a real per-workspace/global
   * permission setting ships in the Settings UI. Wire this up to that
   * setting instead of a hardcoded stub once it exists — for now, mutating
   * tools are implemented but inert by default so enabling them later is
   * just flipping this function, not writing new tool logic.
   */
  mutatingToolsEnabled: () => boolean;
};
