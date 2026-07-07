export type WorkspaceHookTrigger =
  | 'before_worktree_create'
  | 'after_worktree_create'
  | 'before_worktree_remove'
  | 'after_worktree_remove'
  | 'before_worktree_switch'
  | 'after_worktree_switch'
  | 'manual';

export type WorkspaceHookScope = 'worktree' | 'workspace';

export type HookExecutionTarget = 'workspace' | 'trigger_worktree' | 'initiating_worktree';

export type HookExecutionMode = 'terminal_tab';

export type WorkspaceHookShell = 'bash' | 'zsh' | 'pwsh' | 'powershell';

/**
 * Where a hook definition came from. Both sources are stored the same way —
 * a JSON file of `HookFileDefinition`s (see below) — they just live in
 * different files with different write/trust policies:
 *  - 'local': `<workspacePath>/.sproutgit/local-hooks.json`. Not tracked by
 *    git, private to this machine, freely editable by the app. Always
 *    trusted — nothing external ever wrote it.
 *  - 'repo': `<worktreePath>/sproutgit.hooks.json`. Tracked by git, travels
 *    with clone/pull, read-only from the app's perspective (edit + commit
 *    the file to change it). Arrives via `git checkout`, so each hook only
 *    executes once explicitly trusted (per-hook, see HookTrustState).
 */
export type HookSource = 'local' | 'repo';

export type WorkspaceHook = {
  id: string;
  name: string;
  scope: WorkspaceHookScope;
  trigger: WorkspaceHookTrigger;
  executionTarget: HookExecutionTarget;
  executionMode: HookExecutionMode;
  shell: WorkspaceHookShell;
  script: string;
  enabled: boolean;
  critical: boolean;
  switchOncePerSession: boolean;
  switchRunOnCreate: boolean;
  switchRunOnDelete: boolean;
  keepOpenOnCompletion: boolean;
  timeoutSeconds: number;
  createdAt: number;
  updatedAt: number;
  /** Names of other hooks (same source, same file) this one runs after. Informational only today — not enforced as an execution order. */
  dependsOn: string[];
  source: HookSource;
  /** Local hooks are always trusted (the app itself wrote them). Repo hooks require explicit per-hook trust before they'll execute. */
  trusted: boolean;
};

export type HookUpsertInput = {
  name: string;
  scope: WorkspaceHookScope;
  trigger: WorkspaceHookTrigger;
  executionTarget: HookExecutionTarget;
  shell: WorkspaceHookShell;
  script: string;
  enabled: boolean;
  critical: boolean;
  switchOncePerSession: boolean;
  switchRunOnCreate: boolean;
  switchRunOnDelete: boolean;
  keepOpenOnCompletion: boolean;
  timeoutSeconds: number;
  dependsOn: string[];
};

export type WorktreeSwitchHookSource = 'manual' | 'create' | 'delete' | 'load';

// ─── Hook file storage (local-hooks.json / sproutgit.hooks.json) ───────────

/**
 * One hook definition as normalized after reading it off disk — identical
 * shape whether it came from the local file or the repo-tracked one. No
 * DB-assigned id: hooks are identified by `name` within their file, and
 * `dependsOn` references other hooks in the same file by name.
 *
 * Every field except the timestamps is required here because the parser
 * (readHooksFile in hooks-file.ts) always fills in a concrete default —
 * only the *authored* JSON on disk is allowed to omit them.
 */
export type HookFileDefinition = {
  name: string;
  scope: WorkspaceHookScope;
  trigger: WorkspaceHookTrigger;
  executionTarget: HookExecutionTarget;
  shell: WorkspaceHookShell;
  script: string;
  enabled: boolean;
  critical: boolean;
  switchOncePerSession: boolean;
  switchRunOnCreate: boolean;
  switchRunOnDelete: boolean;
  keepOpenOnCompletion: boolean;
  timeoutSeconds: number;
  dependsOn: string[];
  createdAt?: number;
  updatedAt?: number;
};

/** Shape of both `local-hooks.json` and `sproutgit.hooks.json`. */
export type HooksFile = {
  version: 1;
  hooks: HookFileDefinition[];
};

/** Result of listing every hook (local + repo) visible for a worktree. */
export type HookListResult = {
  hooks: WorkspaceHook[];
  /** Parse/validation error for the worktree's sproutgit.hooks.json, if it exists but is invalid. Local-file errors are logged, not surfaced, since the app is the only writer. */
  repoFileError: string | null;
};

export type HookProgressEvent = {
  trigger: string;
  hookId: string;
  hookName: string;
  keepOpenOnCompletion?: boolean;
  phase: 'start' | 'end' | 'skipped';
  status: string;
  stdoutSnippet: string | null;
  stderrSnippet: string | null;
  errorMessage: string | null;
};

export type HookTerminalLaunchEvent = {
  terminalId: string;
  hookId: string;
  hookName: string;
  cwd: string;
  keepOpenOnCompletion: boolean;
};

/** One row of the hook-run audit log (`hook_runs` table), as read back for display/diagnosis. */
export type HookRunRecord = {
  id: string;
  hookId: string;
  hookName: string;
  trigger: string;
  worktreePath: string;
  status: 'success' | 'failure' | 'skipped' | 'timeout';
  stdoutSnippet: string | null;
  stderrSnippet: string | null;
  errorMessage: string | null;
  /** ISO 8601 timestamp. */
  ranAt: string;
};

/** Outcome of a single hook execution attempt — returned by the MCP run_hook tool (and usable anywhere else a caller needs the result rather than just fire-and-forget). */
export type HookRunOutcome = {
  hookId: string;
  hookName: string;
  /** 'not_run' covers every case where the hook never actually executed — not found, disabled, or (for repo hooks) untrusted. `errorMessage` explains which. */
  status: 'success' | 'error' | 'timed_out' | 'not_run';
  errorMessage: string | null;
};
