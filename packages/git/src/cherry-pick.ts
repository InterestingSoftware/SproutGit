import { gitForPath } from './client.js';

/** Thrown when a cherry-pick stops due to conflicts and is rolled back. */
export class CherryPickConflictError extends Error {
  constructor(public readonly sha: string) {
    super(`Cherry-pick of ${sha.slice(0, 7)} stopped due to conflicts and was rolled back.`);
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

    try {
      await git.raw(['cherry-pick', '--abort']);
    } catch {
      // Best-effort: if abort itself fails, surface the original conflict
      // error below rather than the abort failure — the worktree may need
      // manual attention either way, but the conflict is the actionable part.
    }
    throw new CherryPickConflictError(sha);
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
