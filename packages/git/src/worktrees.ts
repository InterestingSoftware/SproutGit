import {
  type WorktreeListResult,
  type WorktreeInfo,
  type CreateWorktreeResult,
  validateBranchName,
} from '@sproutgit/types';
import { normalize, resolve, sep } from 'node:path';
import { gitForPath } from './client.js';

/**
 * Returns all worktrees for the repo at `repoPath`.
 * Parses `git worktree list --porcelain` for reliable structured output.
 */
export async function listWorktrees(repoPath: string): Promise<WorktreeListResult> {
  const git = gitForPath(repoPath);
  const raw = await git.raw(['worktree', 'list', '--porcelain']);
  const worktrees = parseWorktreePorcelain(raw);
  return { repoPath, worktrees };
}

/**
 * Creates a new managed worktree branching from `fromRef`.
 * The worktree is placed at `<managedWorktreesPath>/<newBranch>`.
 */
export async function createManagedWorktree(
  rootRepoPath: string,
  managedWorktreesPath: string,
  fromRef: string,
  newBranch: string
): Promise<CreateWorktreeResult> {
  const branchError = validateBranchName(newBranch);
  if (branchError) {
    throw new Error(`Invalid branch name: ${branchError}`);
  }

  const git = gitForPath(rootRepoPath);
  const worktreePath = `${managedWorktreesPath}/${newBranch}`;

  // Defense in depth: validateBranchName already rejects '..' and path
  // separators that would escape managedWorktreesPath, but re-verify the
  // resolved path stays contained in case validation rules ever change.
  const resolvedRoot = resolve(managedWorktreesPath) + sep;
  const resolvedTarget = resolve(worktreePath);
  if (!(resolvedTarget + sep).startsWith(resolvedRoot)) {
    throw new Error('Worktree path must stay within the managed worktrees directory.');
  }

  await git.raw(['worktree', 'add', '-b', newBranch, worktreePath, fromRef]);

  // normalize() ensures consistent path separators on all platforms so the
  // returned path matches what listWorktrees() returns (which also normalizes).
  return { worktreePath: normalize(worktreePath), branch: newBranch, fromRef };
}

/**
 * Removes a managed worktree and optionally deletes its branch.
 *
 * @param branchName - The exact branch name to delete. Must be provided when
 *   `deleteBranch` is true; deriving it from the path would be incorrect for
 *   branches whose names contain `/` (e.g. `feature/my-thing`).
 */
export async function deleteManagedWorktree(
  rootRepoPath: string,
  worktreePath: string,
  deleteBranch = true,
  branchName?: string | null
): Promise<void> {
  const git = gitForPath(rootRepoPath);
  await git.raw(['worktree', 'remove', '--force', worktreePath]);

  if (deleteBranch && branchName) {
    try {
      await git.raw(['branch', '-D', branchName]);
    } catch {
      // Branch may already be gone — not fatal.
    }
  }
}

// ─── Internal helpers ─────────────────────────────────────────────────────────

function parseWorktreePorcelain(raw: string): WorktreeInfo[] {
  const worktrees: WorktreeInfo[] = [];
  const blocks = raw.trim().split(/\n\n+/);

  for (const block of blocks) {
    const lines = block.trim().split('\n');
    const pathLine = lines.find(l => l.startsWith('worktree '));
    const headLine = lines.find(l => l.startsWith('HEAD '));
    const branchLine = lines.find(l => l.startsWith('branch '));
    const detached = lines.some(l => l === 'detached');

    if (!pathLine) continue;

    worktrees.push({
      path: normalize(pathLine.replace('worktree ', '').trim()),
      head: headLine ? headLine.replace('HEAD ', '').trim() : null,
      branch: branchLine
        ? branchLine.replace('branch refs/heads/', '').trim()
        : null,
      detached,
    });
  }

  return worktrees;
}
