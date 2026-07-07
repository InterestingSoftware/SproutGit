import {
  type WorktreeStatusResult,
  type StatusFileEntry,
  type CheckoutResult,
} from '@sproutgit/types';
import { gitForPath } from './client.js';

/**
 * Returns the working-tree + index status for a worktree.
 * Uses `--porcelain=v1` for stable machine-readable output.
 *
 * `--branch` forces a `## ...` header as the first line even though it's
 * discarded below — `gitForPath` runs with `trimmed: true`, which trims the
 * *entire* raw response as one string, not per line. Without a guaranteed
 * non-whitespace-leading first line, a lone unstaged-only entry like
 * " M file.txt" would have its leading space eaten, shifting every column
 * and silently miscategorizing it as staged.
 */
export async function getWorktreeStatus(worktreePath: string): Promise<WorktreeStatusResult> {
  const git = gitForPath(worktreePath);
  const raw = await git.raw(['status', '--porcelain=v1', '--branch', '-u', '--no-renames']);
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

/**
 * `git status --porcelain=v1` XY codes for an unmerged path — i.e. an active
 * merge/rebase/cherry-pick conflict on that file. See `git help status`.
 */
const CONFLICT_STATUS_CODES = new Set(['DD', 'AU', 'UD', 'UA', 'DU', 'AA', 'UU']);

function parsePorcelainStatus(raw: string): StatusFileEntry[] {
  // The `##` branch header (see getWorktreeStatus) and the empty trailing
  // element left by the final newline are both discarded here.
  return raw
    .split('\n')
    .filter(line => line.length > 0 && !line.startsWith('##'))
    .map(line => {
      // A well-formed porcelain=v1 line is "XY path" — two status columns
      // then a separating space at index 2. But `gitForPath()` constructs
      // its SimpleGit client with `trimmed: true`, which trims the *entire*
      // raw output string (not just its trailing newline) before we ever see
      // it here. When the first-listed file is unstaged-only (index column
      // is a literal space, e.g. " M path"), that leading space is the first
      // character of the whole blob and gets eaten, shifting every column
      // left by one ("M path") — misreporting it as staged and truncating
      // its path. Detect the shift the same way simple-git's own built-in
      // status parser does: a genuine separator lands at index 2; if it
      // instead lands at index 1, the line lost its leading (empty) index
      // column and needs it added back.
      const shifted = line.charAt(2) !== ' ' && line.charAt(1) === ' ';
      const indexStatus = shifted ? ' ' : (line[0] ?? ' ');
      const worktreeStatus = shifted ? line.charAt(0) : (line[1] ?? ' ');
      // Not `.trim()` — porcelain=v1 already has a fixed "XY " prefix, so the
      // rest of the line is the path verbatim. Trimming would silently
      // corrupt a real filename that begins/ends with whitespace; only a
      // trailing `\r` (CRLF checkouts) needs stripping.
      const filePath = (shifted ? line.slice(2) : line.slice(3)).replace(/\r$/, '');

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
        conflicted: CONFLICT_STATUS_CODES.has(`${indexStatus}${worktreeStatus}`),
      } satisfies StatusFileEntry;
    });
}
