import type { CreateWorktreeResult } from '@sproutgit/types';

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
  /**
   * Performs the actual worktree creation. Injected rather than this
   * package calling @sproutgit/git directly, so the host app can point it
   * at the exact same function its own UI uses (app/src/main/worktree-
   * lifecycle.ts) — hooks and provenance recording run identically whether
   * a worktree was created from the UI or by an agent through this tool.
   */
  createWorktree: (args: { fromRef: string; newBranch: string }) => Promise<CreateWorktreeResult>;
  /** Same as createWorktree, but for removal — see app/src/main/worktree-lifecycle.ts. Throws if worktreePath isn't a registered worktree of this repo. */
  removeWorktree: (args: { worktreePath: string; deleteBranch: boolean; branchName?: string | null }) => Promise<void>;
  /**
   * Notifies the host app that a calling agent has finished a session of
   * work in a worktree, so the UI can surface it (e.g. a toast). Purely
   * informational — doesn't touch git or the filesystem, so unlike
   * createWorktree/removeWorktree it isn't gated by mutatingToolsEnabled.
   */
  reportSessionDone: (args: { worktreePath: string; summary: string | null }) => Promise<void>;
};
