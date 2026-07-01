import {
  type WorktreeListResult,
  type WorktreeInfo,
  type CreateWorktreeResult,
  validateBranchName,
} from '@sproutgit/types';
import { normalize, resolve, sep } from 'node:path';
import { realpathSync } from 'node:fs';
import { gitForPath } from './client.js';

/**
 * Returns all worktrees for the repo at `repoPath`.
 * Parses `git worktree list --porcelain` for reliable structured output.
 *
 * When `managedWorktreesPath` is supplied, each entry is classified via
 * `isExternal` — true when it lives outside that directory and isn't the
 * root itself (e.g. a worktree registered by an external tool). Without it,
 * classification defaults to `false` since it can't be determined safely.
 */
export async function listWorktrees(
  repoPath: string,
  managedWorktreesPath?: string
): Promise<WorktreeListResult> {
  const git = gitForPath(repoPath);
  const raw = await git.raw(['worktree', 'list', '--porcelain']);
  const worktrees = parseWorktreePorcelain(raw, repoPath, managedWorktreesPath);
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

/**
 * Resolves symlinks (e.g. macOS's /var → /private/var) so paths that refer
 * to the same directory compare equal even if one side went through a
 * symlinked temp dir and the other didn't. Falls back to a plain `resolve`
 * for paths that don't exist (already-removed worktrees, races, etc).
 *
 * Exported so other IPC handlers that compare a caller-supplied path against
 * git's own worktree list (e.g. deletion validation, hook metadata lookup)
 * use the same symlink-safe comparison instead of a plain `resolve()`.
 */
export function canonicalize(path: string): string {
  try {
    return realpathSync.native(path);
  } catch {
    return resolve(path);
  }
}

/**
 * True when `childPath` is `parentPath` itself or nested inside it, checked
 * on a path-separator boundary (so `worktrees-other` doesn't match `worktrees`).
 * Mirrors the boundary check used by TerminalManagerWithMeta.closeForPath.
 */
function isPathWithin(childPath: string, parentPath: string): boolean {
  const parent = canonicalize(parentPath);
  const child = canonicalize(childPath);
  return child === parent || child.startsWith(parent + sep);
}

/** See `listWorktrees` for the classification rules this implements. */
export function classifyIsExternal(
  worktreePath: string,
  repoPath: string,
  managedWorktreesPath?: string
): boolean {
  if (isPathWithin(worktreePath, repoPath)) return false;
  if (!managedWorktreesPath) return false;
  return !isPathWithin(worktreePath, managedWorktreesPath);
}

function parseWorktreePorcelain(
  raw: string,
  repoPath: string,
  managedWorktreesPath?: string
): WorktreeInfo[] {
  const worktrees: WorktreeInfo[] = [];
  const blocks = raw.trim().split(/\n\n+/);

  for (const block of blocks) {
    const lines = block.trim().split('\n');
    const pathLine = lines.find(l => l.startsWith('worktree '));
    const headLine = lines.find(l => l.startsWith('HEAD '));
    const branchLine = lines.find(l => l.startsWith('branch '));
    const detached = lines.some(l => l === 'detached');

    if (!pathLine) continue;

    const path = normalize(pathLine.replace('worktree ', '').trim());

    worktrees.push({
      path,
      head: headLine ? headLine.replace('HEAD ', '').trim() : null,
      branch: branchLine
        ? branchLine.replace('branch refs/heads/', '').trim()
        : null,
      detached,
      isExternal: classifyIsExternal(path, repoPath, managedWorktreesPath),
    });
  }

  return worktrees;
}
