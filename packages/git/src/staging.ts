import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  type WorktreeStatusResult,
  type StatusFileEntry,
  type CheckoutResult,
  parseFileDiff,
  buildHunkPatch,
} from '@sproutgit/types';
import { gitForPath } from './client.js';
import { getUnstagedFileDiff, getStagedDiff } from './diff.js';

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

/**
 * Stages a single hunk (or a subset of its added/removed lines) from the
 * working tree into the index, by building a patch from the current
 * worktree-vs-index diff for `filePath` and applying it with
 * `git apply --cached`.
 */
export async function stageHunk(
  worktreePath: string,
  filePath: string,
  hunkIndex: number,
  lineIndices?: readonly number[] | null
): Promise<void> {
  const raw = await getUnstagedFileDiff(worktreePath, filePath);
  const fileDiff = parseFileDiff(raw);
  if (!fileDiff) throw new Error(`No unstaged diff found for "${filePath}"`);
  const patch = buildHunkPatch(fileDiff, hunkIndex, lineIndices);
  await applyPatch(worktreePath, patch, false);
}

/**
 * Unstages a single hunk (or a subset of its lines) from the index back to
 * the working tree, by building a patch from the current index-vs-HEAD diff
 * for `filePath` and applying it with `git apply --cached --reverse`.
 */
export async function unstageHunk(
  worktreePath: string,
  filePath: string,
  hunkIndex: number,
  lineIndices?: readonly number[] | null
): Promise<void> {
  const raw = await getStagedDiff(worktreePath, filePath);
  const fileDiff = parseFileDiff(raw);
  if (!fileDiff) throw new Error(`No staged diff found for "${filePath}"`);
  const patch = buildHunkPatch(fileDiff, hunkIndex, lineIndices);
  await applyPatch(worktreePath, patch, true);
}

async function applyPatch(worktreePath: string, patch: string, reverse: boolean): Promise<void> {
  const git = gitForPath(worktreePath);
  const dir = await mkdtemp(join(tmpdir(), 'sproutgit-patch-'));
  const patchPath = join(dir, 'hunk.patch');
  try {
    await writeFile(patchPath, patch, 'utf8');
    const args = ['apply', '--cached', '--recount'];
    if (reverse) args.push('--reverse');
    args.push(patchPath);
    await git.raw(args);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

// ─── Internal helpers ─────────────────────────────────────────────────────────

function parsePorcelainStatus(raw: string): StatusFileEntry[] {
  const lines = raw.trim().split('\n').filter(Boolean);

  // `gitForPath()` configures simple-git with `trimmed: true`, which runs a
  // whole-string `.trim()` on git's stdout. When the very first status line
  // legitimately starts with a space (an unstaged-only change, e.g.
  // " M file.txt"), that leading space is indistinguishable from incidental
  // whitespace and gets stripped too, shifting every column in that line
  // left by one. A well-formed `--porcelain=v1` line always has a space at
  // index 2 (right after the two status columns) — restore the loss if
  // that invariant doesn't hold for the first line.
  const first = lines[0];
  if (first !== undefined && first[2] !== ' ') {
    lines[0] = ` ${first}`;
  }

  return lines
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
