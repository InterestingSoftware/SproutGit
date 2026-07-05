/**
 * Workspace initialisation, import and inspection handlers.
 *
 * A SproutGit workspace lives at `workspacePath` and contains:
 *   .sproutgit/
 *     root/       ← the bare git repo — always bare, never checked out
 *     worktrees/  ← managed worktrees
 *     state.db    ← per-workspace sqlite state
 */
import { BrowserWindow } from 'electron';
import { IPC } from '@sproutgit/types';
import type { WorkspaceInitResult, WorkspaceStatus, ImportRepoMode } from '@sproutgit/types';
import { mkdirSync, existsSync } from 'fs';
import { join, dirname } from 'path';
import { cp, mkdir, rename, rm } from 'fs/promises';
import { initBareRepo, cloneBareRepo, convertToBareWithWorktree } from '@sproutgit/git';
import { openWorkspaceDb } from '@sproutgit/database';
import { handle } from './handle.js';
import { workspaceDbPath as stateDbPath } from './workspace.js';

function sproutDir(workspacePath: string) {
  return join(workspacePath, '.sproutgit');
}
function rootPath(workspacePath: string) {
  return join(sproutDir(workspacePath), 'root');
}
function worktreesPath(workspacePath: string) {
  return join(sproutDir(workspacePath), 'worktrees');
}
function metadataPath(workspacePath: string) {
  return join(sproutDir(workspacePath), 'metadata');
}

/** Create the directory structure (and optionally clone a repo). */
async function initWorkspace(
  workspacePath: string,
  repoUrl?: string | null,
  onProgress?: (message: string) => void,
): Promise<WorkspaceInitResult> {
  const root = rootPath(workspacePath);
  const wt = worktreesPath(workspacePath);
  const meta = metadataPath(workspacePath);

  mkdirSync(root, { recursive: true });
  mkdirSync(wt, { recursive: true });
  mkdirSync(meta, { recursive: true });

  let cloned = false;
  if (repoUrl?.trim()) {
    await cloneBareRepo(repoUrl.trim(), root, onProgress);
    cloned = true;
  } else if (!existsSync(join(root, 'HEAD'))) {
    await initBareRepo(root);
  }

  // Run migrations to ensure state.db is ready, then release the connection.
  // workspace.ts will open its own cached connection on first IPC access.
  openWorkspaceDb(stateDbPath(workspacePath)).close();

  return {
    workspacePath,
    rootPath: root,
    worktreesPath: wt,
    metadataPath: meta,
    stateDbPath: stateDbPath(workspacePath),
    cloned,
  };
}

/**
 * Import an existing non-bare repo in place (no file moves).
 *
 * The source repo's `.git` is converted to a bare repo at `.sproutgit/root`
 * and its currently-checked-out branch is recreated as a managed worktree —
 * root is never left as a live checkout, same as a freshly cloned/init'd
 * workspace. Throws `DirtyWorkingTreeError`/`DetachedHeadError` (surfaced to
 * the user as-is) if the source isn't in a state that can be converted.
 */
async function importInPlace(sourceRepoPath: string): Promise<WorkspaceInitResult> {
  const root = rootPath(sourceRepoPath);
  const wt = worktreesPath(sourceRepoPath);
  const meta = metadataPath(sourceRepoPath);

  mkdirSync(wt, { recursive: true });
  mkdirSync(meta, { recursive: true });

  await convertToBareWithWorktree(sourceRepoPath, root, wt);

  // Run migrations to ensure state.db is ready, then release the connection.
  // workspace.ts will open its own cached connection on first IPC access.
  openWorkspaceDb(stateDbPath(sourceRepoPath)).close();

  return {
    workspacePath: sourceRepoPath,
    rootPath: root,
    worktreesPath: wt,
    metadataPath: meta,
    stateDbPath: stateDbPath(sourceRepoPath),
    cloned: false,
  };
}

function emitGitOpProgress(win: BrowserWindow | null, message: string, phase: string): void {
  if (!win || win.isDestroyed()) return;
  win.webContents.send(IPC.EVENT_GIT_OP_PROGRESS, { message, phase });
}

function isCrossDeviceRenameError(error: unknown): boolean {
  return typeof error === 'object' && error !== null && 'code' in error && (error as { code?: string }).code === 'EXDEV';
}

async function importByMode(
  sourceRepoPath: string,
  mode: ImportRepoMode,
  workspacePath?: string | null,
  win?: BrowserWindow | null,
): Promise<WorkspaceInitResult> {
  const trimmedWorkspacePath = workspacePath?.trim() ?? '';

  if (mode === 'inPlace' || trimmedWorkspacePath === '' || trimmedWorkspacePath === sourceRepoPath) {
    emitGitOpProgress(win ?? null, 'Importing repository in place…', 'import');
    return importInPlace(sourceRepoPath);
  }

  await mkdir(dirname(trimmedWorkspacePath), { recursive: true });

  if (existsSync(trimmedWorkspacePath)) {
    throw new Error(`Workspace already exists: ${trimmedWorkspacePath}`);
  }

  if (mode === 'move') {
    emitGitOpProgress(win ?? null, 'Moving repository into workspace…', 'import');
    try {
      await rename(sourceRepoPath, trimmedWorkspacePath);
    } catch (error) {
      if (!isCrossDeviceRenameError(error)) throw error;
      emitGitOpProgress(win ?? null, 'Moving repository across devices…', 'import');
      await cp(sourceRepoPath, trimmedWorkspacePath, { recursive: true, preserveTimestamps: true });
      await rm(sourceRepoPath, { recursive: true, force: true });
    }
  } else if (mode === 'copy') {
    emitGitOpProgress(win ?? null, 'Copying repository into workspace…', 'import');
    await cp(sourceRepoPath, trimmedWorkspacePath, { recursive: true, preserveTimestamps: true });
  } else {
    throw new Error(`Unsupported import mode: ${mode}`);
  }

  emitGitOpProgress(win ?? null, 'Preparing SproutGit metadata…', 'import');
  return importInPlace(trimmedWorkspacePath);
}

/**
 * Detects a pre-existing on-disk layout with a live working tree at "root"
 * and folds it into the bare-root layout, in place, the first time it's
 * seen — every layout SproutGit has ever produced converges to a single
 * bare-root + managed-worktrees shape. Two shapes qualify:
 *
 *   Legacy Rust layout:            workspacePath/root/.git (main worktree)
 *   Imported in-place (old code):  workspacePath/.git
 *
 * No-op once `.sproutgit/root` already exists. Propagates
 * `DirtyWorkingTreeError`/`DetachedHeadError` unchanged if the source can't
 * be converted yet — the workspace is left untouched and callers should
 * surface the error to the user (commit/stash, or check out a branch).
 */
async function migrateLegacyLayoutIfNeeded(workspacePath: string): Promise<void> {
  const newRoot = rootPath(workspacePath);
  if (existsSync(newRoot)) return;

  const legacyRoot = join(workspacePath, 'root');
  const sourceRepoPath = existsSync(join(legacyRoot, '.git'))
    ? legacyRoot
    : existsSync(join(workspacePath, '.git'))
      ? workspacePath
      : null;
  if (!sourceRepoPath) return;

  const newWt = worktreesPath(workspacePath);
  mkdirSync(newWt, { recursive: true });
  await convertToBareWithWorktree(sourceRepoPath, newRoot, newWt);
}

async function inspectWorkspace(workspacePath: string): Promise<WorkspaceStatus> {
  await migrateLegacyLayoutIfNeeded(workspacePath);

  const sprout = sproutDir(workspacePath);
  const root = rootPath(workspacePath);
  const wt = worktreesPath(workspacePath);
  const meta = metadataPath(workspacePath);
  const db = stateDbPath(workspacePath);

  return {
    workspacePath,
    gitRepoPath: existsSync(root) ? root : '',
    rootPath: root,
    worktreesPath: wt,
    metadataPath: meta,
    stateDbPath: db,
    isSproutgitProject: existsSync(sprout),
    rootExists: existsSync(root),
    worktreesExists: existsSync(wt),
    metadataExists: existsSync(meta),
    stateDbExists: existsSync(db),
  };
}

export function registerWorkspaceInitHandlers(): void {
  handle(IPC.WORKSPACE_CREATE, async (_e, args: {
    workspacePath: string;
    repoUrl?: string | null;
  }) => {
    const win = BrowserWindow.fromWebContents(_e.sender);
    const onProgress = win ? (msg: string) => {
      if (!win.isDestroyed()) {
        win.webContents.send(IPC.EVENT_GIT_OP_PROGRESS, { message: msg, phase: 'clone' });
      }
    } : undefined;
    return initWorkspace(args.workspacePath, args.repoUrl, onProgress);
  });

  handle(IPC.WORKSPACE_IMPORT, async (_e, args: {
    sourceRepoPath: string;
    mode: ImportRepoMode;
    workspacePath?: string | null;
  }) => importByMode(args.sourceRepoPath, args.mode, args.workspacePath, BrowserWindow.fromWebContents(_e.sender)));

  handle(IPC.WORKSPACE_INSPECT, (_e, workspacePath: string) =>
    inspectWorkspace(workspacePath),
  );
}
