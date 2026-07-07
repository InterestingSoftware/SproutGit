import { type WorktreeHealth } from '@sproutgit/types';
import { gitForPath } from './client.js';

/** Default number of worktrees whose health is computed concurrently. */
const DEFAULT_CONCURRENCY = 4;

/**
 * Computes ahead/behind counts and last-commit age for a single worktree.
 * Ahead/behind is measured against the branch's upstream when it has one,
 * falling back to `baseRef` (typically the repo's default remote branch)
 * otherwise — matching how `git status` reports ahead/behind when tracking
 * is configured, while still giving branches with no upstream a meaningful
 * comparison.
 */
export async function getWorktreeHealth(
  worktreePath: string,
  baseRef?: string | null
): Promise<WorktreeHealth> {
  const git = gitForPath(worktreePath);

  const [lastCommitRaw, upstream] = await Promise.all([
    git.raw(['log', '-1', '--format=%aI']).catch(() => ''),
    git
      .raw(['rev-parse', '--abbrev-ref', '--symbolic-full-name', '@{u}'])
      .then(r => r.trim())
      .catch(() => null),
  ]);

  const compareRef = upstream ?? (baseRef || null);

  let ahead = 0;
  let behind = 0;
  if (compareRef) {
    try {
      // `--left-right --count A...B` prints "<left-only> <right-only>" —
      // left (compareRef) is what we're behind on, right (HEAD) is ahead.
      const raw = await git.raw(['rev-list', '--left-right', '--count', `${compareRef}...HEAD`]);
      const [behindStr, aheadStr] = raw.trim().split(/\s+/);
      behind = parseInt(behindStr ?? '0', 10) || 0;
      ahead = parseInt(aheadStr ?? '0', 10) || 0;
    } catch {
      // compareRef doesn't resolve (deleted branch, unrelated history, etc.)
      // — leave ahead/behind at 0 rather than failing the whole snapshot.
    }
  }

  return {
    worktreePath,
    ahead,
    behind,
    lastCommitAt: lastCommitRaw.trim() || null,
    hasUpstream: upstream !== null,
    compareRef,
  };
}

/**
 * Computes health for every worktree in `worktreePaths`, capping how many
 * run at once. Each worktree's health already fans out to a handful of git
 * subprocesses (log, rev-parse, rev-list) — running all worktrees fully in
 * parallel would spawn far more `git` processes at once than is useful,
 * especially in workspaces with a dozen+ worktrees.
 *
 * Entries are only present for worktrees whose health was computed
 * successfully — a worktree removed mid-refresh is simply absent from the
 * result rather than throwing, so callers must treat a missing key as
 * "no data yet" rather than an error.
 */
export async function getWorktreesHealth(
  worktreePaths: string[],
  baseRef?: string | null,
  concurrency = DEFAULT_CONCURRENCY
): Promise<Partial<Record<string, WorktreeHealth>>> {
  // Object.create(null) avoids prototype-pollution surprises from a worktree
  // path that happens to collide with an Object.prototype key name (e.g. a
  // directory literally named "__proto__" or "constructor") — paths here
  // ultimately come from the filesystem/git worktree names.
  const result: Partial<Record<string, WorktreeHealth>> = Object.create(null);
  let next = 0;

  async function worker(): Promise<void> {
    while (next < worktreePaths.length) {
      const worktreePath = worktreePaths[next++]!;
      try {
        result[worktreePath] = await getWorktreeHealth(worktreePath, baseRef);
      } catch {
        // Skip worktrees whose health can't be computed (e.g. removed
        // mid-refresh) — the caller just shows no badge for that row.
      }
    }
  }

  // Clamp to at least 1 worker whenever there's work to do — Math.min alone
  // would spawn zero workers (and silently return no results at all) for a
  // non-empty worktreePaths list if concurrency was passed as 0 or negative.
  const workerCount = worktreePaths.length === 0 ? 0 : Math.max(1, Math.min(concurrency, worktreePaths.length));
  await Promise.all(Array.from({ length: workerCount }, worker));
  return result;
}
