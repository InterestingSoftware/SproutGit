import { canonicalize } from '@sproutgit/paths';

const chains = new Map<string, Promise<void>>();

/**
 * Serializes git worktree-admin commands (`add`/`remove`/`list`/`repair`)
 * against the same repo, keyed by its canonicalized path.
 *
 * All of these read or write git's `worktrees/<name>/locked` bookkeeping
 * under the hood. `git worktree list --porcelain` in particular checks
 * whether that file exists and then reads it as two separate steps
 * (`worktree_lock_reason()` in git's own C source) — if an `add`/`remove`
 * from a concurrent call touches that file in between, git aborts the
 * *entire* listing with `fatal: failed to read '...locked': No such file or
 * directory`. This app polls worktree state in the background (e.g. sidebar
 * change-count refetches) while also letting the user trigger mutations, so
 * without serialization a `list` and an `add` can race against the same repo
 * with no external actor involved. Queuing them here removes that race at
 * the source instead of retrying after the fact.
 *
 * Deliberately scoped to worktree-admin commands only — status/diff/commit
 * operate on a specific worktree's own working directory/index and don't
 * touch this shared bookkeeping, so serializing them here would only add
 * latency for no safety benefit.
 */
export function withWorktreeLock<T>(repoPath: string, fn: () => Promise<T>): Promise<T> {
  const key = canonicalize(repoPath);
  const prior = chains.get(key) ?? Promise.resolve();
  const result = prior.then(fn, fn);
  const cleanup = result.then(() => undefined, () => undefined);
  chains.set(key, cleanup);
  // Only remove the entry if it's still exactly the one we just settled — if a
  // newer call queued behind us in the meantime, it will have replaced this
  // value in the map, and deleting here would drop its chain instead.
  cleanup.then(() => {
    if (chains.get(key) === cleanup) {
      chains.delete(key);
    }
  });
  return result;
}

/** @internal exposed for tests only, to assert the map doesn't leak entries. */
export function _getWorktreeLockMapSizeForTests(): number {
  return chains.size;
}
