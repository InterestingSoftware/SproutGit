/**
 * Cross-platform recursive directory watching.
 *
 * Node's native `fs.watch(path, { recursive: true })` only works on macOS
 * and Windows — on Linux it throws `ERR_FEATURE_UNAVAILABLE_ON_PLATFORM`
 * synchronously. On macOS/Windows we keep using the native mechanism
 * unchanged (it's reliable there and this codebase already depends on its
 * exact semantics — e.g. a Windows worktree-delete flow needs the watch
 * handle released as soon as the directory goes away, which native fs.watch
 * already does but chokidar's own watch bookkeeping does not, causing
 * directory removal to hang). Linux-only, we fall back to chokidar, which
 * emulates recursion with per-directory watches instead of throwing.
 */
import { watch as fsWatch } from 'node:fs';
import { join } from 'node:path';
import chokidar, { type FSWatcher as ChokidarWatcher } from 'chokidar';

export type RecursiveWatchEvent = 'add' | 'change' | 'unlink' | 'addDir' | 'unlinkDir';

type Closable = { close: () => void | Promise<void> };

const NATIVE_RECURSIVE_SUPPORTED = process.platform === 'win32' || process.platform === 'darwin';

/**
 * Watches `root` recursively and invokes `onEvent` for every add/change/
 * remove under it. Returns `null` if the watch couldn't be set up (e.g.
 * `root` doesn't exist yet on macOS/Windows) — matching the old
 * try/catch-and-skip behavior callers already expect on those platforms.
 * On Linux, `root` doesn't need to exist yet — chokidar picks it up once
 * created (e.g. a bare repo's `worktrees/` admin dir, which doesn't exist
 * until the first `git worktree add`).
 */
export function watchRecursive(
  root: string,
  onEvent: (event: RecursiveWatchEvent, path: string) => void,
  ignored?: (path: string) => boolean,
): Closable | null {
  if (NATIVE_RECURSIVE_SUPPORTED) {
    try {
      return fsWatch(root, { persistent: false, recursive: true }, (eventType, filename) => {
        if (!filename) return;
        const absolutePath = join(root, filename);
        if (ignored?.(absolutePath)) return;
        // Native fs.watch only distinguishes 'rename' (create/delete/rename)
        // vs 'change' (content write) — coarser than chokidar's add/change/
        // unlink, but every current caller only cares that *something*
        // changed, not the precise kind.
        onEvent(eventType === 'rename' ? 'add' : 'change', absolutePath);
      });
    } catch {
      return null; // path doesn't exist (yet) — same as the old behavior here
    }
  }

  const watcher: ChokidarWatcher = chokidar.watch(root, {
    persistent: false,
    ignoreInitial: true,
    ...(ignored ? { ignored } : {}),
  });
  watcher.on('all', (event, changedPath) => onEvent(event as RecursiveWatchEvent, changedPath));
  return watcher;
}

/** Closes a watcher returned by `watchRecursive` (or a plain `node:fs` FSWatcher), swallowing errors either way. */
export function closeWatcher(watcher: Closable): void {
  try {
    const result = watcher.close();
    if (result && typeof (result as Promise<void>).catch === 'function') {
      void (result as Promise<void>).catch(() => undefined);
    }
  } catch {
    /* ignore */
  }
}
