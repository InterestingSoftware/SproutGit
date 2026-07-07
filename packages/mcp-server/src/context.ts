import type {
  CreateWorktreeResult,
  HookListResult,
  HookRunOutcome,
  HookRunRecord,
  HookUpsertInput,
} from '@sproutgit/types';

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
   * informational — it never mutates git or filesystem state (the handler's
   * own known-worktree check does read via listWorktrees, but that's the
   * same read every other read-only tool does), so unlike
   * createWorktree/removeWorktree it isn't gated by mutatingToolsEnabled.
   */
  reportSessionDone: (args: { worktreePath: string; summary: string | null }) => Promise<void>;

  /**
   * Lists effective hooks (local + repo merged, each tagged with its
   * source, trigger, enabled/trusted state) — `getEffectiveHooks` in
   * app/src/main/ipc/hooks.ts. Pass `null` for `worktreePath` to see only
   * workspace-level local hooks with no worktree in view. Read-only: this
   * is the *entire* trust-related surface exposed over MCP — there is no
   * corresponding trust tool anywhere in this package.
   */
  listHooks: (worktreePath: string | null) => HookListResult;
  /** Reads the hook-run audit log for one worktree, most recent first — app/src/main/ipc/workspace.ts's listHookRuns. */
  listHookRuns: (worktreePath: string, limit?: number) => HookRunRecord[];
  /**
   * Local-hook writes only (`.sproutgit/local-hooks.json`) — repo hooks
   * (`sproutgit.hooks.json`) stay read-only through MCP, same as the app's
   * own UI. These delegate to the exact same createLocalHook/updateLocalHook/
   * deleteLocalHook/toggleLocalHook functions app/src/main/ipc/hooks.ts's
   * HOOK_CREATE/UPDATE/DELETE/TOGGLE IPC handlers use, including dependsOn
   * validation — never duplicated here.
   */
  createLocalHook: (input: HookUpsertInput) => void;
  updateLocalHook: (id: string, input: Partial<HookUpsertInput>) => void;
  deleteLocalHook: (id: string) => void;
  toggleLocalHook: (id: string, enabled: boolean) => void;
  /**
   * Runs one hook through the exact same execution path as the Run Hook
   * dialog (app/src/main/ipc/hooks.ts's runHook). Never bypasses trust — an
   * untrusted repo hook, a disabled hook, or an unknown hookId all resolve
   * with `status: 'not_run'` and an explanatory `errorMessage`, instead of
   * throwing or silently no-op-ing.
   */
  runHook: (args: { hookId: string; worktreePath: string; initiatingWorktreePath?: string | null }) => Promise<HookRunOutcome>;
};
