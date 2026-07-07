import type { ConflictFileContentResult, ConflictStageContent } from '@sproutgit/types';
import { gitForPath } from './client.js';

/**
 * Matches the two `git show :<stage>:<path>` failure messages that mean
 * "this stage genuinely has no entry for this path" — a normal outcome for
 * e.g. a file added on only one side of a conflict. Any other failure (repo
 * corruption, permissions, ...) is a real error and must not be swallowed.
 */
const MISSING_STAGE_ENTRY = /is in the index, but not at stage \d|does not exist \(neither on disk nor in the index\)/;

/**
 * Reads one index stage (1 = base, 2 = ours, 3 = theirs) for a conflicted
 * path via `git show :<stage>:<path>`. A stage can be missing entirely —
 * e.g. a file added on only one side of the conflict has no base — which
 * git reports as a non-zero exit rather than empty output.
 */
async function readConflictStage(
  worktreePath: string,
  stage: 1 | 2 | 3,
  relativePath: string
): Promise<ConflictStageContent> {
  const git = gitForPath(worktreePath);
  try {
    const content = await git.raw(['show', `:${stage}:${relativePath}`]);
    return { exists: true, content };
  } catch (err) {
    if (err instanceof Error && MISSING_STAGE_ENTRY.test(err.message)) {
      return { exists: false, content: '' };
    }
    throw err;
  }
}

/**
 * Returns the base/ours/theirs blobs for an unmerged path, read from the
 * index stages git populates during a conflicted merge/rebase/cherry-pick —
 * independent of whatever the working-tree copy currently contains.
 */
export async function getConflictFileContent(
  worktreePath: string,
  relativePath: string
): Promise<ConflictFileContentResult> {
  const [base, ours, theirs] = await Promise.all([
    readConflictStage(worktreePath, 1, relativePath),
    readConflictStage(worktreePath, 2, relativePath),
    readConflictStage(worktreePath, 3, relativePath),
  ]);
  return { worktreePath, path: relativePath, base, ours, theirs };
}
