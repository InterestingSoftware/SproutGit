import { type WorktreeHealth } from '@sproutgit/types';
import { gitForPath } from './client.js';
import { getWorktreeStatus } from './staging.js';

/** Default number of worktrees whose health is computed concurrently. */
const DEFAULT_CONCURRENCY = 4;

/**
 * Computes ahead/behind counts, dirty-file count, and last-commit age for a
 * single worktree. Ahead/behind is measured against the branch's upstream
 * when it has one, falling back to `baseRef` (typically the repo's default
 * remote branch) otherwise — matching how `git status` reports ahead/behind
 * when tracking is configured, while still giving branches with no upstream
 * a meaningful comparison.
 */
export async function getWorktreeHealth(
  worktreePath: string,
  baseRef?: string | null
): Promise<WorktreeHealth> {
  const git = gitForPath(worktreePath);

  const [status, lastCommitRaw, upstream] = await Promise.all([
    getWorktreeStatus(worktreePath),
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
    dirtyCount: status.files.length,
    lastCommitAt: lastCommitRaw.trim() || null,
    hasUpstream: upstream !== null,
    compareRef,
  };
}

/**
 * Computes health for every worktree in `worktreePaths`, capping how many
 * run at once. Each worktree's health already fans out to a handful of git
 * subprocesses (status, log, rev-parse, rev-list) — running all worktrees
 * fully in parallel would spawn far more `git` processes at once than is
 * useful, especially in workspaces with a dozen+ worktrees.
 */
export async function getWorktreesHealth(
  worktreePaths: string[],
  baseRef?: string | null,
  concurrency = DEFAULT_CONCURRENCY
): Promise<Record<string, WorktreeHealth>> {
  const result: Record<string, WorktreeHealth> = {};
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

  const workerCount = Math.min(concurrency, worktreePaths.length);
  await Promise.all(Array.from({ length: workerCount }, worker));
  return result;
}
