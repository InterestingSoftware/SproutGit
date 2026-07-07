import {
  type WorktreeStatusResult,
  type StatusFileEntry,
  type CheckoutResult,
} from '@sproutgit/types';
import { gitForPath } from './client.js';

/**
 * Returns the working-tree + index status for a worktree.
 * Uses `--porcelain=v1` for stable machine-readable output.
 */
export async function getWorktreeStatus(worktreePath: string): Promise<WorktreeStatusResult> {
  const git = gitForPath(worktreePath);
  const raw = await git.raw(['status', '--porcelain=v1', '-u', '--no-renames']);
  const files = parsePorcelainStatus(raw);
  return { worktreePath, files };
}

/**
 * Stages the specified file paths (or all files if paths is empty).
 */
export async function stageFiles(worktreePath: string, paths: string[]): Promise<void> {
  const git = gitForPath(worktreePath);
  if (paths.length === 0) {
    await git.raw(['add', '--all']);
  } else {
    await git.raw(['add', '--', ...paths]);
  }
}

/**
 * Unstages the specified file paths (or all staged files if paths is empty).
 */
export async function unstageFiles(worktreePath: string, paths: string[]): Promise<void> {
  const git = gitForPath(worktreePath);
  if (paths.length === 0) {
    await git.raw(['reset', 'HEAD', '--']);
  } else {
    await git.raw(['reset', 'HEAD', '--', ...paths]);
  }
}

/**
 * Creates a commit in the worktree with the given message.
 */
export async function createCommit(worktreePath: string, message: string): Promise<string> {
  const git = gitForPath(worktreePath);
  const result = await git.commit(message);
  return result.commit;
}

/**
 * Checks out a ref in the worktree, optionally auto-stashing dirty state.
 */
export async function checkoutWorktree(
  worktreePath: string,
  targetRef: string,
  autoStash = true
): Promise<CheckoutResult> {
  const git = gitForPath(worktreePath);

  const statusResult = await git.status();
  const isDirty = !statusResult.isClean();
  let stashed = false;

  const previousBranch = statusResult.current;

  if (isDirty && autoStash) {
    await git.stash();
    stashed = true;
  }

  await git.checkout(targetRef);
  const newStatus = await git.status();

  return {
    worktreePath,
    previousBranch,
    newBranch: newStatus.current ?? targetRef,
    stashed,
  };
}

/**
 * Resets the worktree branch to a target ref.
 */
export async function resetWorktreeBranch(
  worktreePath: string,
  targetRef: string,
  mode: 'soft' | 'mixed' | 'hard'
): Promise<void> {
  const git = gitForPath(worktreePath);
  await git.raw(['reset', `--${mode}`, targetRef]);
}

// ─── Internal helpers ─────────────────────────────────────────────────────────

function parsePorcelainStatus(raw: string): StatusFileEntry[] {
  // Trailing-only: a leading space on the first line is meaningful (index
  // status "clean"), so a whole-string `.trim()` would eat it and shift
  // every fixed-column parse below off by one character.
  return raw
    .replace(/\s+$/, '')
    .split('\n')
    .filter(Boolean)
    .map(line => {
      const indexStatus = line[0] ?? ' ';
      const worktreeStatus = line[1] ?? ' ';
      const filePath = line.slice(3).trim();

      // Staged = index column is not a space or '?'
      const staged = indexStatus !== ' ' && indexStatus !== '?';
      const status = staged ? indexStatus : worktreeStatus;

      return {
        path: filePath,
        originalPath: null,
        staged,
        status,
        indexStatus,
        workTreeStatus: worktreeStatus,
      } satisfies StatusFileEntry;
    });
}
