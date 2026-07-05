import { app } from 'electron';
import { handle } from './handle.js';
import { IPC } from '@sproutgit/types';
import { openConfigDb, openWorkspaceDb, eq, notInArray } from '@sproutgit/database';
import { join } from 'path';
import { recentWorkspaces } from '@sproutgit/database/schema/config';
import { log } from '../telemetry.js';
import { stopWatchingPath } from './watcher.js';
import { stopMcpServer } from '../mcp-bridge.js';
import { waitForIdleRepo } from '@sproutgit/git';
import {
  worktreeMetadata,
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

/**
 * Closes and evicts the cached workspace-DB connection for `workspacePath`,
 * if one is open. Exported so callers that need the underlying sqlite file
 * to actually be removable/renamable right after this call — the
 * WORKSPACE_CLOSE handler below, and worktree-lifecycle.ts's tests, which
 * hit this same cache indirectly via setWorktreeMeta() — can force it
 * closed instead of leaving it cached for the rest of the process
 * lifetime (an open handle blocks deleting the directory on Windows).
 */
export function closeWorkspaceDbCache(workspacePath: string): void {
  const db = workspaceDbCache.get(workspacePath);
  if (db) {
    db.close();
    workspaceDbCache.delete(workspacePath);
  }
}

export interface SetWorktreeMetaArgs {
  workspacePath: string;
  worktreePath: string;
  branch?: string;
  sourceRef?: string;
  rootRepoPath?: string;
  issueRef?: string | null;
  issueTitle?: string | null;
}

/**
 * Upserts worktree provenance/issue-ref metadata. Exported standalone so
 * worktree-lifecycle.ts (shared by both the renderer's worktree:create IPC
 * call and the MCP create_worktree tool) can record it directly, without a
 * client-side IPC round-trip.
 */
export function setWorktreeMeta(args: SetWorktreeMetaArgs): void {
  const db = getWorkspaceDb(args.workspacePath);
  const now = new Date();
  db.insert(worktreeMetadata)
    .values({
      worktreePath: args.worktreePath,
      branch: args.branch ?? '',
      sourceRef: args.sourceRef ?? '',
      rootRepoPath: args.rootRepoPath ?? '',
      issueRef: args.issueRef ?? null,
      issueTitle: args.issueTitle ?? null,
      createdAt: now,
      updatedAt: now,
    })
    .onConflictDoUpdate({
      target: worktreeMetadata.worktreePath,
      set: {
        branch: args.branch ?? '',
        sourceRef: args.sourceRef ?? '',
        rootRepoPath: args.rootRepoPath ?? '',
        issueRef: args.issueRef ?? null,
        issueTitle: args.issueTitle ?? null,
        updatedAt: now,
      },
    })
    .run();
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

  handle(IPC.WORKSPACE_CLOSE, async (_e, workspacePath: string) => {
    const gitRepoPath = join(workspacePath, '.sproutgit', 'root');

    // Background queries (issue tracker patterns, push status, change-count
    // polling, ...) aren't cancelled just because the component that started
    // them unmounted — wait for any git command already in flight against
    // this repo to settle, so its process doesn't still hold a file handle
    // on root the moment after this call returns.
    await waitForIdleRepo(gitRepoPath);

    // Release the MCP socket server too — same reasoning as the watcher
    // below: an open listener on a socket file inside .sproutgit/ would
    // block removing that directory on Windows, and leaving it running
    // after the workspace closes would let a stale bridge connection keep
    // operating against a workspace the UI no longer considers open.
    await stopMcpServer(workspacePath);

    closeWorkspaceDbCache(workspacePath);
    // Release the fs.watch handles on root too — same reason as the DB
    // close above: on Windows an open watch handle blocks removing the
    // directory it's watching, so anything about to delete this workspace
    // needs both released first.
    stopWatchingPath(gitRepoPath);
  });

  // ── Worktree metadata ─────────────────────────────────────────────────────
  handle(IPC.WORKTREE_GET_META, (_e, args: { workspacePath: string; worktreePath: string }) => {
    const db = getWorkspaceDb(args.workspacePath);
    return db.select().from(worktreeMetadata)
      .where(eq(worktreeMetadata.worktreePath, args.worktreePath))
      .get() ?? null;
  });

  handle(IPC.WORKTREE_SET_META, (_e, args: SetWorktreeMetaArgs) => {
    setWorktreeMeta(args);
  });

  // Drops worktree_metadata rows for paths git no longer reports (deleted
  // externally, or removed via `git worktree remove` outside the app). This
  // mirrors `git worktree prune` semantics for our own bookkeeping only —
  // it never touches the actual git worktree registration.
  handle(IPC.WORKTREE_PRUNE_METADATA, (_e, args: { workspacePath: string; activeWorktreePaths: string[] }) => {
    if (args.activeWorktreePaths.length === 0) return; // avoid wiping everything on a transient empty list
    const db = getWorkspaceDb(args.workspacePath);
    db.delete(worktreeMetadata)
      .where(notInArray(worktreeMetadata.worktreePath, args.activeWorktreePaths))
      .run();
  });

  // Hook CRUD/listing (HOOK_LIST/CREATE/UPDATE/DELETE/TOGGLE) live in
  // ipc/hooks.ts now — they read/write local-hooks.json and merge in repo
  // hooks, rather than the DB tables this file used to own directly.

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
