/**
 * File-system watcher that emits IPC events when git HEAD or refs change.
 * Watches HEAD and FETCH_HEAD (single files) with Node's built-in
 * `fs.watch`; watches `refs/` and `worktrees/` (which need to recurse into
 * subdirectories) via the cross-platform `watchRecursive` helper — native
 * recursive `fs.watch` on macOS/Windows (unchanged from before), chokidar
 * only on Linux, where native recursive watching isn't supported at all.
 *
 * `repoPath` here is always the bare root itself (`gitRepoPath`, e.g.
 * `<workspace>/.sproutgit/root`) — root is always bare, so HEAD/refs/
 * FETCH_HEAD live directly under it, not under a `.git` subdirectory.
 * Callers must not start watching before root exists (i.e. before any
 * bare-root migration has finished): on Windows, `fs.watch` holds an open
 * handle on the watched path, and starting a watch on a not-yet-converted
 * repo's `.git` would block the rename that converts it (EPERM).
 */
import { ipcMain, type BrowserWindow } from 'electron';
import { IPC } from '@sproutgit/types';
import { watch } from 'node:fs';
import { join, resolve } from 'node:path';
import { watchRecursive, closeWatcher } from '../lib/recursive-watch.js';

type Closable = { close: () => void | Promise<void> };

const activeWatchers = new Map<string, Closable[]>();

function watchPath(
  repoPath: string,
  win: BrowserWindow,
): Closable[] {
  const watchers: Closable[] = [];

  const emitWorktreeChanged = () => {
    win.webContents.send(IPC.EVENT_WORKTREE_CHANGED, { repoPath });
  };

  const emitRefsChanged = () => {
    win.webContents.send(IPC.EVENT_GIT_REFS_CHANGED, { repoPath });
  };

  try {
    // Watch HEAD for branch switches
    const headWatcher = watch(
      join(repoPath, 'HEAD'),
      { persistent: false },
      () => emitWorktreeChanged(),
    );
    watchers.push(headWatcher);
  } catch { /* path may not exist */ }

  // Watch refs recursively for new commits / remote updates. Uses the
  // cross-platform watchRecursive helper (native fs.watch on macOS/Windows,
  // chokidar on Linux, where native recursive watching throws).
  const refsWatcher = watchRecursive(join(repoPath, 'refs'), () => emitRefsChanged());
  if (refsWatcher) watchers.push(refsWatcher);

  try {
    // FETCH_HEAD changes after git fetch
    const fetchHeadWatcher = watch(
      join(repoPath, 'FETCH_HEAD'),
      { persistent: false },
      () => emitRefsChanged(),
    );
    watchers.push(fetchHeadWatcher);
  } catch { /* path may not exist */ }

  // Git records one admin subdirectory per linked worktree under
  // <bare root>/worktrees/<name> — this is where `git worktree add/remove`
  // (run by us or an external tool like Claude Code) shows up, regardless
  // of where the actual worktree checkout lives on disk. This directory may
  // not exist yet (no worktree has ever been added).
  const worktreesWatcher = watchRecursive(join(repoPath, 'worktrees'), () => emitWorktreeChanged());
  if (worktreesWatcher) watchers.push(worktreesWatcher);

  return watchers;
}

/**
 * Closes and forgets any active watchers for `repoPath`. Exported so other
 * IPC handlers that fully tear down a workspace (e.g. closing it before its
 * directory gets deleted) can release these handles too — on Windows an
 * open `fs.watch` handle blocks removing the directory it's watching, the
 * same class of lock `WORKSPACE_CLOSE` already releases for the sqlite
 * connection.
 */
export function stopWatchingPath(repoPath: string): void {
  const normalised = resolve(repoPath);
  const watchers = activeWatchers.get(normalised);
  if (!watchers) return;
  for (const w of watchers) closeWatcher(w);
  activeWatchers.delete(normalised);
}

export function registerWatchHandlers(getWindow: () => BrowserWindow | null): void {
  ipcMain.handle(IPC.WATCH_START, (_e, repoPath: string) => {
    const normalised = resolve(repoPath);
    if (activeWatchers.has(normalised)) return; // already watching

    const win = getWindow();
    if (!win) return;

    const watchers = watchPath(normalised, win);
    if (watchers.length > 0) {
      activeWatchers.set(normalised, watchers);
    }
  });

  ipcMain.handle(IPC.WATCH_STOP, (_e, repoPath: string) => {
    stopWatchingPath(repoPath);
  });
}
