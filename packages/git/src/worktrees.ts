import {
  type WorktreeListResult,
  type WorktreeInfo,
  type CreateWorktreeResult,
  validateBranchName,
} from '@sproutgit/types';
import { canonicalize, isPathWithin } from '@sproutgit/paths';
import { normalize, resolve, sep } from 'node:path';
import { gitForPath } from './client.js';
import { withWorktreeLock } from './worktree-lock.js';

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
  return withWorktreeLock(repoPath, async () => {
    // Belt-and-suspenders retry: withWorktreeLock rules out races between our
    // *own* concurrent calls, but an external tool (or an OS-level scan) can
    // still touch this repo's worktree metadata at the same moment — see
    // withWorktreeLock's doc comment for the exact git-internal race.
    let raw: string;
    try {
      raw = await gitForPath(repoPath).raw(['worktree', 'list', '--porcelain']);
    } catch {
      raw = await gitForPath(repoPath).raw(['worktree', 'list', '--porcelain']);
    }
    return { repoPath, worktrees: parseWorktreePorcelain(raw, repoPath, managedWorktreesPath) };
  });
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

  const worktreePath = `${managedWorktreesPath}/${newBranch}`;

  // Defense in depth: validateBranchName already rejects '..' and path
  // separators that would escape managedWorktreesPath, but re-verify the
  // resolved path stays contained in case validation rules ever change.
  const resolvedRoot = resolve(managedWorktreesPath) + sep;
  const resolvedTarget = resolve(worktreePath);
  if (!(resolvedTarget + sep).startsWith(resolvedRoot)) {
    throw new Error('Worktree path must stay within the managed worktrees directory.');
  }

  return withWorktreeLock(rootRepoPath, async () => {
    await gitForPath(rootRepoPath).raw(['worktree', 'add', '-b', newBranch, worktreePath, fromRef]);
    // normalize() ensures consistent path separators on all platforms so the
    // returned path matches what listWorktrees() returns (which also normalizes).
    return { worktreePath: normalize(worktreePath), branch: newBranch, fromRef };
  });
}

/**
 * Attaches an existing branch to a new managed worktree at
 * `<managedWorktreesPath>/<branch>`, without creating a new branch.
 * Used when migrating a repo that already has the branch checked out
 * elsewhere (e.g. converting an imported repo to a bare root).
 */
export async function addWorktreeForExistingBranch(
  rootRepoPath: string,
  managedWorktreesPath: string,
  branch: string
): Promise<CreateWorktreeResult> {
  const branchError = validateBranchName(branch);
  if (branchError) {
    throw new Error(`Invalid branch name: ${branchError}`);
  }

  const worktreePath = `${managedWorktreesPath}/${branch}`;

  const resolvedRoot = resolve(managedWorktreesPath) + sep;
  const resolvedTarget = resolve(worktreePath);
  if (!(resolvedTarget + sep).startsWith(resolvedRoot)) {
    throw new Error('Worktree path must stay within the managed worktrees directory.');
  }

  return withWorktreeLock(rootRepoPath, async () => {
    await gitForPath(rootRepoPath).raw(['worktree', 'add', worktreePath, branch]);
    return { worktreePath: normalize(worktreePath), branch, fromRef: branch };
  });
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
  await withWorktreeLock(rootRepoPath, async () => {
    const git = gitForPath(rootRepoPath);
    await git.raw(['worktree', 'remove', '--force', worktreePath]);

    if (deleteBranch && branchName) {
      try {
        await git.raw(['branch', '-D', branchName]);
      } catch {
        // Branch may already be gone — not fatal.
      }
    }
  });
}

// ─── Internal helpers ─────────────────────────────────────────────────────────

/**
 * True when `childPath` is `parentPath` itself or nested inside it.
 * Canonicalizes both sides first since one may come through git's own
 * realpath-based reporting and the other from local path construction (e.g.
 * macOS's /var vs /private/var).
 */
function isWithinCanonical(childPath: string, parentPath: string): boolean {
  return isPathWithin(canonicalize(childPath), canonicalize(parentPath));
}

/** See `listWorktrees` for the classification rules this implements. */
export function classifyIsExternal(
  worktreePath: string,
  repoPath: string,
  managedWorktreesPath?: string
): boolean {
  if (isWithinCanonical(worktreePath, repoPath)) return false;
  if (!managedWorktreesPath) return false;
  return !isWithinCanonical(worktreePath, managedWorktreesPath);
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
    // The bare repo itself shows up as a `bare` pseudo-entry (no HEAD/branch,
    // nothing checked out) — it's storage, not a worktree the app should
    // ever surface, select, or run working-tree operations against.
    const isBarePseudoEntry = lines.some(l => l === 'bare');

    if (!pathLine || isBarePseudoEntry) continue;

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
