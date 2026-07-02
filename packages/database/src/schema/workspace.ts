import { index, int, primaryKey, sqliteTable, text } from 'drizzle-orm/sqlite-core';

// ─── worktree_metadata ───────────────────────────────────────────────────────

/**
 * Records the provenance of every managed worktree so the UI can show where a
 * worktree was forked from, when it was created, etc.
 */
export const worktreeMetadata = sqliteTable('worktree_metadata', {
  worktreePath: text('worktree_path').primaryKey(),
  branch: text('branch').notNull(),
  sourceRef: text('source_ref').notNull(),
  initiatingWorktreePath: text('initiating_worktree_path'),
  issueRef: text('issue_ref'),
  issueTitle: text('issue_title'),
  rootRepoPath: text('root_repo_path').notNull(),
  createdAt: int('created_at', { mode: 'timestamp_ms' }).notNull(),
  updatedAt: int('updated_at', { mode: 'timestamp_ms' }).notNull(),
});

// ─── hook_definitions ────────────────────────────────────────────────────────

/** User-defined lifecycle hooks that run before/after worktree operations. */
export const hookDefinitions = sqliteTable('hook_definitions', {
  id: text('id').primaryKey(),
  name: text('name').notNull(),
  scope: text('scope', { enum: ['worktree', 'workspace'] }).notNull(),
  trigger: text('trigger', {
    enum: [
      'before_worktree_create',
      'after_worktree_create',
      'before_worktree_remove',
      'after_worktree_remove',
      'before_worktree_switch',
      'after_worktree_switch',
      'manual',
    ],
  }).notNull(),
  executionTarget: text('execution_target', {
    enum: ['workspace', 'trigger_worktree', 'initiating_worktree'],
  }).notNull(),
  executionMode: text('execution_mode', { enum: ['terminal_tab'] })
    .notNull()
    .default('terminal_tab'),
  shell: text('shell', { enum: ['bash', 'zsh', 'pwsh', 'powershell'] }).notNull(),
  script: text('script').notNull(),
  enabled: int('enabled', { mode: 'boolean' }).notNull().default(true),
  critical: int('critical', { mode: 'boolean' }).notNull().default(false),
  switchOncePerSession: int('switch_once_per_session', { mode: 'boolean' })
    .notNull()
    .default(false),
  switchRunOnCreate: int('switch_run_on_create', { mode: 'boolean' }).notNull().default(true),
  switchRunOnDelete: int('switch_run_on_delete', { mode: 'boolean' }).notNull().default(false),
  keepOpenOnCompletion: int('keep_open_on_completion', { mode: 'boolean' })
    .notNull()
    .default(false),
  timeoutSeconds: int('timeout_seconds').notNull().default(300),
  createdAt: int('created_at', { mode: 'timestamp_ms' }).notNull(),
  updatedAt: int('updated_at', { mode: 'timestamp_ms' }).notNull(),
}, (t) => ({
  // Every hook-lookup query in hooks.ts filters by trigger (e.g. all
  // "before_worktree_switch" hooks for a workspace).
  triggerIdx: index('hook_definitions_trigger_idx').on(t.trigger),
}));

// ─── hook_dependencies ───────────────────────────────────────────────────────

/** Directed edges in the hook DAG: `hookId` must run before `dependsOnId`. */
export const hookDependencies = sqliteTable('hook_dependencies', {
  hookId: text('hook_id')
    .notNull()
    .references(() => hookDefinitions.id, { onDelete: 'cascade' }),
  dependsOnId: text('depends_on_id')
    .notNull()
    .references(() => hookDefinitions.id, { onDelete: 'cascade' }),
}, (t) => ({
  pk: primaryKey({ columns: [t.hookId, t.dependsOnId] }),
}));

// ─── hook_runs ───────────────────────────────────────────────────────────────

/** Audit log of every hook execution. */
export const hookRuns = sqliteTable('hook_runs', {
  id: text('id').primaryKey(),
  hookId: text('hook_id').notNull(),
  hookName: text('hook_name').notNull(),
  trigger: text('trigger').notNull(),
  worktreePath: text('worktree_path').notNull(),
  status: text('status', { enum: ['success', 'failure', 'skipped', 'timeout'] }).notNull(),
  stdoutSnippet: text('stdout_snippet'),
  stderrSnippet: text('stderr_snippet'),
  errorMessage: text('error_message'),
  ranAt: int('ran_at', { mode: 'timestamp_ms' }).notNull(),
});

// ─── nested_repo_sync_rules ──────────────────────────────────────────────────

/** Per-workspace rules for syncing nested git repos across worktrees. */
export const nestedRepoSyncRules = sqliteTable('nested_repo_sync_rules', {
  repoRelativePath: text('repo_relative_path').primaryKey(),
  enabled: int('enabled', { mode: 'boolean' }).notNull().default(true),
  createdAt: int('created_at', { mode: 'timestamp_ms' }).notNull(),
  updatedAt: int('updated_at', { mode: 'timestamp_ms' }).notNull(),
});

// ─── workspace_state ─────────────────────────────────────────────────────────

/** General-purpose key/value store for per-workspace UI state. */
export const workspaceState = sqliteTable('workspace_state', {
  key: text('key').primaryKey(),
  value: text('value').notNull(),
});
