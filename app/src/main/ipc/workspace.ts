import { app } from 'electron';
import { handle } from './handle.js';
import { IPC, type WorkspaceHookShell, type WorkspaceHookTrigger, type WorkspaceHookScope, type HookExecutionTarget } from '@sproutgit/types';
import { openConfigDb, openWorkspaceDb, eq } from '@sproutgit/database';
import { join } from 'path';
import { recentWorkspaces } from '@sproutgit/database/schema/config';
import { log } from '../telemetry.js';
import {
  worktreeMetadata,
  hookDefinitions,
  hookDependencies,
  hookRuns,
  nestedRepoSyncRules,
  workspaceState,
} from '@sproutgit/database/schema/workspace';

type ConfigDb = ReturnType<typeof openConfigDb>;

// Per-workspace DB instances are cached by path.
const workspaceDbCache = new Map<string, ReturnType<typeof openWorkspaceDb>>();

function getWorkspaceDb(workspacePath: string) {
  const cached = workspaceDbCache.get(workspacePath);
  if (cached) return cached;
  const dbPath = join(workspacePath, '.sproutgit', 'state.db');
  const db = openWorkspaceDb(dbPath);
  workspaceDbCache.set(workspacePath, db);
  return db;
}

export function registerWorkspaceHandlers(configDb: ConfigDb): void {
  // ── Recent workspaces ─────────────────────────────────────────────────────
  handle(IPC.WORKSPACE_LIST_RECENT, () => {
    const rows = configDb
      .select()
      .from(recentWorkspaces)
      .orderBy(recentWorkspaces.lastOpenedAt)
      .all();
    log.info('[workspace] listRecentWorkspaces: returning', rows.length, 'items');
    return rows;
  });

  handle(IPC.WORKSPACE_ADD_RECENT, (_e, workspacePath: string) => {
    log.info('[workspace] addRecentWorkspace:', workspacePath);
    configDb
      .insert(recentWorkspaces)
      .values({ workspacePath, lastOpenedAt: new Date() })
      .onConflictDoUpdate({
        target: recentWorkspaces.workspacePath,
        set: { lastOpenedAt: new Date() },
      })
      .run();
    // Also register with the OS so macOS Dock "Open Recent" and Windows
    // taskbar jump list stay in sync with the app's own recent list.
    app.addRecentDocument(workspacePath);
  });

  handle(IPC.WORKSPACE_REMOVE_RECENT, (_e, workspacePath: string) => {
    configDb
      .delete(recentWorkspaces)
      .where(eq(recentWorkspaces.workspacePath, workspacePath))
      .run();
  });

  // ── Per-workspace UI state ──────────────────────────────────────────────────

  handle(IPC.WORKSPACE_GET_STATE, (_e, args: { workspacePath: string; key: string }) => {
    const db = getWorkspaceDb(args.workspacePath);
    const row = db.select().from(workspaceState).where(eq(workspaceState.key, args.key)).get();
    return row?.value ?? null;
  });

  handle(IPC.WORKSPACE_SET_STATE, (_e, args: { workspacePath: string; key: string; value: string }) => {
    const db = getWorkspaceDb(args.workspacePath);
    db.insert(workspaceState)
      .values({ key: args.key, value: args.value })
      .onConflictDoUpdate({ target: workspaceState.key, set: { value: args.value } })
      .run();
  });

  handle(IPC.WORKSPACE_CLOSE, (_e, workspacePath: string) => {
    const db = workspaceDbCache.get(workspacePath);
    if (db) {
      db.close();
      workspaceDbCache.delete(workspacePath);
    }
  });

  // ── Worktree metadata ─────────────────────────────────────────────────────
  handle(IPC.WORKTREE_GET_META, (_e, args: { workspacePath: string; worktreePath: string }) => {
    const db = getWorkspaceDb(args.workspacePath);
    return db.select().from(worktreeMetadata)
      .where(eq(worktreeMetadata.worktreePath, args.worktreePath))
      .get() ?? null;
  });

  handle(IPC.WORKTREE_SET_META, (_e, args: {
    workspacePath: string;
    worktreePath: string;
    branch?: string;
    sourceRef?: string;
    rootRepoPath?: string;
  }) => {
    const db = getWorkspaceDb(args.workspacePath);
    const now = new Date();
    db.insert(worktreeMetadata)
      .values({
        worktreePath: args.worktreePath,
        branch: args.branch ?? '',
        sourceRef: args.sourceRef ?? '',
        rootRepoPath: args.rootRepoPath ?? '',
        createdAt: now,
        updatedAt: now,
      })
      .onConflictDoUpdate({
        target: worktreeMetadata.worktreePath,
        set: {
          branch: args.branch ?? '',
          sourceRef: args.sourceRef ?? '',
          rootRepoPath: args.rootRepoPath ?? '',
          updatedAt: now,
        },
      })
      .run();
  });

  // ── Hook definitions ──────────────────────────────────────────────────────
  handle(IPC.HOOK_LIST, (_e, workspacePath: string) => {
    const db = getWorkspaceDb(workspacePath);
    const hooks = db.select().from(hookDefinitions).all();
    const deps = db.select().from(hookDependencies).all();
    const depsMap = new Map<string, string[]>();
    for (const dep of deps) {
      if (!depsMap.has(dep.hookId)) depsMap.set(dep.hookId, []);
      depsMap.get(dep.hookId)!.push(dep.dependsOnId);
    }
    return hooks.map(h => ({ ...h, dependencyIds: depsMap.get(h.id) ?? [] }));
  });

  handle(IPC.HOOK_CREATE, (_e, args: {
    workspacePath: string;
    id: string;
    name: string;
    scope: WorkspaceHookScope;
    trigger: WorkspaceHookTrigger;
    executionTarget: HookExecutionTarget;
    shell: WorkspaceHookShell;
    script: string;
    enabled?: boolean;
    critical?: boolean;
    switchOncePerSession?: boolean;
    switchRunOnCreate?: boolean;
    switchRunOnDelete?: boolean;
    keepOpenOnCompletion?: boolean;
    timeoutSeconds?: number;
    dependencyIds?: string[];
  }) => {
    const db = getWorkspaceDb(args.workspacePath);
    const now = new Date();
    db.insert(hookDefinitions).values({
      id: args.id,
      name: args.name,
      scope: args.scope,
      trigger: args.trigger,
      executionTarget: args.executionTarget,
      shell: args.shell,
      script: args.script,
      enabled: args.enabled !== false,
      critical: args.critical ?? false,
      switchOncePerSession: args.switchOncePerSession ?? false,
      switchRunOnCreate: args.switchRunOnCreate ?? true,
      switchRunOnDelete: args.switchRunOnDelete ?? false,
      keepOpenOnCompletion: args.keepOpenOnCompletion ?? false,
      timeoutSeconds: args.timeoutSeconds ?? 300,
      createdAt: now,
      updatedAt: now,
    }).run();
    for (const depId of args.dependencyIds ?? []) {
      db.insert(hookDependencies).values({ hookId: args.id, dependsOnId: depId }).run();
    }
  });

  handle(IPC.HOOK_UPDATE, (_e, args: {
    workspacePath: string;
    id: string;
    name?: string;
    scope?: WorkspaceHookScope;
    trigger?: WorkspaceHookTrigger;
    executionTarget?: HookExecutionTarget;
    shell?: WorkspaceHookShell;
    script?: string;
    enabled?: boolean;
    critical?: boolean;
    switchOncePerSession?: boolean;
    switchRunOnCreate?: boolean;
    switchRunOnDelete?: boolean;
    keepOpenOnCompletion?: boolean;
    timeoutSeconds?: number;
    dependencyIds?: string[];
  }) => {
    const db = getWorkspaceDb(args.workspacePath);
    const set: Record<string, unknown> = { updatedAt: new Date() };
    if (args.name !== undefined) set['name'] = args.name;
    if (args.scope !== undefined) set['scope'] = args.scope;
    if (args.trigger !== undefined) set['trigger'] = args.trigger;
    if (args.executionTarget !== undefined) set['executionTarget'] = args.executionTarget;
    if (args.shell !== undefined) set['shell'] = args.shell;
    if (args.script !== undefined) set['script'] = args.script;
    if (args.enabled !== undefined) set['enabled'] = args.enabled;
    if (args.critical !== undefined) set['critical'] = args.critical;
    if (args.switchOncePerSession !== undefined) set['switchOncePerSession'] = args.switchOncePerSession;
    if (args.switchRunOnCreate !== undefined) set['switchRunOnCreate'] = args.switchRunOnCreate;
    if (args.switchRunOnDelete !== undefined) set['switchRunOnDelete'] = args.switchRunOnDelete;
    if (args.keepOpenOnCompletion !== undefined) set['keepOpenOnCompletion'] = args.keepOpenOnCompletion;
    if (args.timeoutSeconds !== undefined) set['timeoutSeconds'] = args.timeoutSeconds;
    db.update(hookDefinitions)
      .set(set as never)
      .where(eq(hookDefinitions.id, args.id))
      .run();
    if (args.dependencyIds !== undefined) {
      db.delete(hookDependencies).where(eq(hookDependencies.hookId, args.id)).run();
      for (const depId of args.dependencyIds) {
        db.insert(hookDependencies).values({ hookId: args.id, dependsOnId: depId }).run();
      }
    }
  });

  handle(IPC.HOOK_DELETE, (_e, args: { workspacePath: string; id: string }) => {
    const db = getWorkspaceDb(args.workspacePath);
    db.delete(hookDefinitions).where(eq(hookDefinitions.id, args.id)).run();
  });

  handle(IPC.HOOK_RUN_LOG, (_e, args: {
    workspacePath: string;
    id: string;
    hookId: string;
    hookName: string;
    trigger: string;
    worktreePath: string;
    status: 'success' | 'failure' | 'skipped' | 'timeout';
    stdoutSnippet?: string;
    stderrSnippet?: string;
    errorMessage?: string;
  }) => {
    const db = getWorkspaceDb(args.workspacePath);
    db.insert(hookRuns).values({
      id: args.id,
      hookId: args.hookId,
      hookName: args.hookName,
      trigger: args.trigger,
      worktreePath: args.worktreePath,
      status: args.status,
      stdoutSnippet: args.stdoutSnippet ?? null,
      stderrSnippet: args.stderrSnippet ?? null,
      errorMessage: args.errorMessage ?? null,
      ranAt: new Date(),
    }).run();
  });

  // ── Worktree provenance ────────────────────────────────────────────────────
  handle(IPC.WORKTREE_LIST_PROVENANCE, (_e, workspacePath: string) => {
    const db = getWorkspaceDb(workspacePath);
    return db.select().from(worktreeMetadata).all();
  });

  handle(IPC.WORKTREE_GET_PROVENANCE, (_e, args: {
    workspacePath: string;
    worktreePath: string;
  }) => {
    const db = getWorkspaceDb(args.workspacePath);
    return db.select().from(worktreeMetadata)
      .where(eq(worktreeMetadata.worktreePath, args.worktreePath))
      .get() ?? null;
  });

  // ── Nested repo sync rules ─────────────────────────────────────────────────
  handle(IPC.NESTED_REPO_LIST, (_e, workspacePath: string) => {
    const db = getWorkspaceDb(workspacePath);
    return db.select().from(nestedRepoSyncRules).all();
  });

  handle(IPC.NESTED_REPO_UPSERT, (_e, args: {
    workspacePath: string;
    repoRelativePath: string;
    enabled: boolean;
  }) => {
    const db = getWorkspaceDb(args.workspacePath);
    const now = new Date();
    db.insert(nestedRepoSyncRules)
      .values({ repoRelativePath: args.repoRelativePath, enabled: args.enabled, createdAt: now, updatedAt: now })
      .onConflictDoUpdate({
        target: nestedRepoSyncRules.repoRelativePath,
        set: { enabled: args.enabled, updatedAt: now },
      })
      .run();
  });

  handle(IPC.NESTED_REPO_DELETE, (_e, args: {
    workspacePath: string;
    repoRelativePath: string;
  }) => {
    const db = getWorkspaceDb(args.workspacePath);
    db.delete(nestedRepoSyncRules)
      .where(eq(nestedRepoSyncRules.repoRelativePath, args.repoRelativePath))
      .run();
  });
}
