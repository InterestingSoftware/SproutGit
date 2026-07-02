import { mkdir, rename, rm, cp, readdir } from 'node:fs/promises';
import { dirname, resolve, sep } from 'node:path';
import { gitForPath } from './client.js';
import { getWorktreeStatus } from './staging.js';
import { addWorktreeForExistingBranch, listWorktrees, canonicalize } from './worktrees.js';

/** Thrown when a conversion source has uncommitted changes. */
export class DirtyWorkingTreeError extends Error {
  constructor(sourceRepoPath: string) {
    super(`Cannot convert "${sourceRepoPath}" to a bare repo: it has uncommitted changes. Commit or stash them first.`);
    this.name = 'DirtyWorkingTreeError';
  }
}

/** Thrown when a conversion source has a detached HEAD. */
export class DetachedHeadError extends Error {
  constructor(sourceRepoPath: string) {
    super(`Cannot convert "${sourceRepoPath}" to a bare repo: HEAD is detached. Check out a branch first.`);
    this.name = 'DetachedHeadError';
  }
}

function isCrossDeviceError(error: unknown): boolean {
  return typeof error === 'object' && error !== null && 'code' in error && (error as { code?: string }).code === 'EXDEV';
}

async function moveDir(source: string, destination: string): Promise<void> {
  try {
    await rename(source, destination);
  } catch (error) {
    if (!isCrossDeviceError(error)) throw error;
    await cp(source, destination, { recursive: true, preserveTimestamps: true });
    await rm(source, { recursive: true, force: true });
  }
}

function isAncestorOrEqual(parent: string, child: string): boolean {
  const resolvedParent = resolve(parent);
  const resolvedChild = resolve(child);
  return resolvedChild === resolvedParent || resolvedChild.startsWith(resolvedParent + sep);
}

/**
 * Converts an existing non-bare repo at `sourceRepoPath` into a bare repo at
 * `barePath`, then recreates its currently-checked-out branch as a managed
 * worktree under `managedWorktreesPath`. Used both for importing an existing
 * repo and for migrating a legacy (live-checkout) workspace layout.
 *
 * Refuses to touch anything if the source is dirty or has a detached HEAD —
 * callers should surface `DirtyWorkingTreeError`/`DetachedHeadError` to the
 * user rather than attempting to carry over uncommitted state.
 */
export async function convertToBareWithWorktree(
  sourceRepoPath: string,
  barePath: string,
  managedWorktreesPath: string
): Promise<{ branch: string; worktreePath: string }> {
  const status = await getWorktreeStatus(sourceRepoPath);
  if (status.files.length > 0) {
    throw new DirtyWorkingTreeError(sourceRepoPath);
  }

  const sourceGit = gitForPath(sourceRepoPath);
  let branch: string;
  try {
    branch = await sourceGit.raw(['symbolic-ref', '--short', 'HEAD']);
  } catch {
    throw new DetachedHeadError(sourceRepoPath);
  }
  branch = branch.trim();

  // Some imported repos may already have other linked worktrees registered
  // against sourceRepoPath (e.g. created before this migration ran). Moving
  // the main repo breaks their `.git` gitdir pointers, so capture their
  // paths now and repair them with git's own tooling after the move.
  // Compare via canonicalize() (realpath), not a plain resolve() — git always
  // reports worktree paths through their resolved form (e.g. macOS's
  // /var -> /private/var), so a literal-string comparison against
  // sourceRepoPath would fail to exclude the main worktree itself.
  const { worktrees: existingWorktrees } = await listWorktrees(sourceRepoPath);
  const sourceCanonical = canonicalize(sourceRepoPath);
  const otherWorktreePaths = existingWorktrees
    .map(w => w.path)
    .filter(path => canonicalize(path) !== sourceCanonical);

  const sourceGitDir = `${sourceRepoPath}/.git`;
  await mkdir(dirname(barePath), { recursive: true });
  await moveDir(sourceGitDir, barePath);

  const bareGit = gitForPath(barePath);
  await bareGit.raw(['config', 'core.bare', 'true']);
  try {
    await bareGit.raw(['config', '--unset', 'core.worktree']);
  } catch {
    // Not set — nothing to unset.
  }

  if (otherWorktreePaths.length > 0) {
    await bareGit.raw(['worktree', 'repair', ...otherWorktreePaths]);
  }

  const { worktreePath } = await addWorktreeForExistingBranch(barePath, managedWorktreesPath, branch);

  // Clean up the leftover working-tree files. If sourceRepoPath is an
  // ancestor of the new bare/worktrees paths (e.g. imported-in-place, where
  // sourceRepoPath is the whole workspace), only remove its stray children —
  // `.sproutgit` (and anything else under it) must survive. Otherwise the
  // source directory (e.g. a legacy `workspacePath/root`) is now fully
  // redundant and can be removed outright.
  if (isAncestorOrEqual(sourceRepoPath, barePath) || isAncestorOrEqual(sourceRepoPath, managedWorktreesPath)) {
    const entries = await readdir(sourceRepoPath);
    for (const entry of entries) {
      if (entry === '.sproutgit') continue;
      await rm(`${sourceRepoPath}/${entry}`, { recursive: true, force: true });
    }
  } else {
    await rm(sourceRepoPath, { recursive: true, force: true });
  }

  return { branch, worktreePath };
}
