import { canonicalize } from '@sproutgit/paths';

const pendingCounts = new Map<string, number>();

/**
 * Tracks `promise` as an in-flight git operation for `repoPath` until it
 * settles (success or failure). Used by `gitForPath()` so `waitForIdleRepo()`
 * can tell whether any git command against a repo is still running —
 * background queries (issue tracker patterns, push status, change-count
 * polling, etc.) aren't cancelled just because the component that started
 * them unmounted, so a stray in-flight git.exe can still hold a file handle
 * on the repo after the app considers a workspace "closed."
 */
export function trackGitOperation<T>(repoPath: string, promise: Promise<T>): Promise<T> {
  const key = canonicalize(repoPath);
  pendingCounts.set(key, (pendingCounts.get(key) ?? 0) + 1);
  const decrement = (): void => {
    const n = (pendingCounts.get(key) ?? 1) - 1;
    if (n <= 0) pendingCounts.delete(key);
    else pendingCounts.set(key, n);
  };
  promise.then(decrement, decrement);
  return promise;
}

/**
 * Resolves once no tracked git operation for `repoPath` is in flight, or
 * after `timeoutMs` — whichever comes first, so a stuck/hung command can't
 * block a caller (e.g. closing a workspace) indefinitely.
 */
export async function waitForIdleRepo(repoPath: string, timeoutMs = 5_000): Promise<void> {
  const key = canonicalize(repoPath);
  const start = Date.now();
  while ((pendingCounts.get(key) ?? 0) > 0 && Date.now() - start < timeoutMs) {
    await new Promise(resolve => setTimeout(resolve, 50));
  }
}
