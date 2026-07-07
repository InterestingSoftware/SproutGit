import { gitForPath } from './client.js';

/**
 * Thrown when a cherry-pick stops due to conflicts. `abortFailed` reflects
 * whether `git cherry-pick --abort` itself succeeded — if it didn't, the
 * worktree may still be mid-cherry-pick and needs manual attention, so the
 * message must not claim a clean rollback happened.
 */
export class CherryPickConflictError extends Error {
  constructor(public readonly sha: string, public readonly abortFailed = false) {
    super(
      abortFailed
        ? `Cherry-pick of ${sha.slice(0, 7)} stopped due to conflicts, and the automatic rollback failed. Run "git cherry-pick --abort" manually to restore a clean state.`
        : `Cherry-pick of ${sha.slice(0, 7)} stopped due to conflicts and was rolled back.`
    );
    this.name = 'CherryPickConflictError';
  }
}

/**
 * Cherry-picks a single commit onto the current branch of `worktreePath`.
 *
 * If the cherry-pick stops due to a conflict, it's aborted immediately
 * rather than left mid-cherry-pick: there's no conflict-resolution UI yet
 * (tracked separately), so a half-applied cherry-pick would just look like a
 * silently broken repo. The caller sees a `CherryPickConflictError` and the
 * worktree is back to its pre-cherry-pick state.
 */
export async function cherryPickCommit(worktreePath: string, sha: string): Promise<void> {
  const git = gitForPath(worktreePath);
  try {
    await git.raw(['cherry-pick', sha]);
  } catch (error) {
    if (!isCherryPickConflict(error)) throw error;

    let abortFailed = false;
    try {
      await git.raw(['cherry-pick', '--abort']);
    } catch {
      abortFailed = true;
    }
    throw new CherryPickConflictError(sha, abortFailed);
  }
}

function isCherryPickConflict(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);
  return (
    message.includes('after resolving the conflicts') ||
    message.includes('CONFLICT (') ||
    message.includes('could not apply')
  );
}
