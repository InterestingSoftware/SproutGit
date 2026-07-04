/**
 * Cross-platform recursive directory watching.
 *
 * Node's native `fs.watch(path, { recursive: true })` only works on macOS
 * and Windows — on Linux it throws `ERR_FEATURE_UNAVAILABLE_ON_PLATFORM`
 * synchronously. Every recursive watch in the main process goes through
 * chokidar instead (it falls back to per-directory watches on platforms
 * without native recursive support), so ref-change detection and file
 * live-sync actually work on Linux instead of being silently swallowed by
 * a try/catch around a throwing `fs.watch` call.
 */
import chokidar, { type FSWatcher } from 'chokidar';

export type RecursiveWatchEvent = 'add' | 'change' | 'unlink' | 'addDir' | 'unlinkDir';

/**
 * Watches `root` recursively and invokes `onEvent` for every add/change/
 * remove under it. `root` doesn't need to exist yet — chokidar picks it up
 * once created (e.g. a bare repo's `worktrees/` admin dir, which doesn't
 * exist until the first `git worktree add`).
 */
export function watchRecursive(
  root: string,
  onEvent: (event: RecursiveWatchEvent, path: string) => void,
  ignored?: (path: string) => boolean,
): FSWatcher {
  const watcher = chokidar.watch(root, {
    // Matches the rest of this file's fs.watch calls (persistent: false) —
    // an open handle shouldn't keep the main-process event loop alive if a
    // shutdown path skips WATCH_STOP.
    persistent: false,
    ignoreInitial: true,
    ...(ignored ? { ignored } : {}),
  });
  watcher.on('all', (event, changedPath) => onEvent(event as RecursiveWatchEvent, changedPath));
  return watcher;
}

/** Closes a watcher returned by `watchRecursive` (or a plain `node:fs` FSWatcher), swallowing errors either way. */
export function closeWatcher(watcher: { close: () => void | Promise<void> }): void {
  try {
    const result = watcher.close();
    if (result && typeof (result as Promise<void>).catch === 'function') {
      void (result as Promise<void>).catch(() => undefined);
    }
  } catch {
    /* ignore */
  }
}
