/**
 * File-system watcher that emits IPC events when git HEAD or refs change.
 * Uses Node's built-in `fs.watch` on HEAD and refs to detect branch switches
 * and new commits.
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
import { watch, type FSWatcher } from 'node:fs';
import { join, resolve } from 'node:path';

const activeWatchers = new Map<string, FSWatcher[]>();

function watchPath(
  repoPath: string,
  win: BrowserWindow,
): FSWatcher[] {
  const watchers: FSWatcher[] = [];

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

  try {
    // Watch refs recursively for new commits / remote updates
    const refsWatcher = watch(
      join(repoPath, 'refs'),
      { persistent: false, recursive: true },
      () => emitRefsChanged(),
    );
    watchers.push(refsWatcher);
  } catch { /* path may not exist */ }

  try {
    // FETCH_HEAD changes after git fetch
    const fetchHeadWatcher = watch(
      join(repoPath, 'FETCH_HEAD'),
      { persistent: false },
      () => emitRefsChanged(),
    );
    watchers.push(fetchHeadWatcher);
  } catch { /* path may not exist */ }

  try {
    // Git records one admin subdirectory per linked worktree under
    // <bare root>/worktrees/<name> — this is where `git worktree add/remove`
    // (run by us or an external tool like Claude Code) shows up, regardless
    // of where the actual worktree checkout lives on disk.
    const worktreesAdminWatcher = watch(
      join(repoPath, 'worktrees'),
      { persistent: false, recursive: true },
      () => emitWorktreeChanged(),
    );
    watchers.push(worktreesAdminWatcher);
  } catch { /* path may not exist */ }

  return watchers;
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
    const normalised = resolve(repoPath);
    const watchers = activeWatchers.get(normalised);
    if (!watchers) return;
    for (const w of watchers) {
      try { w.close(); } catch { /* ignore */ }
    }
    activeWatchers.delete(normalised);
  });
}
