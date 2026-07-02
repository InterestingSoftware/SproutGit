import { mkdir, rename, rm, cp, readdir } from 'node:fs/promises';
import { basename, dirname, join } from 'node:path';
import { canonicalize, isPathWithin } from '@sproutgit/paths';
import { gitForPath } from './client.js';
import { getWorktreeStatus } from './staging.js';
import { addWorktreeForExistingBranch, listWorktrees } from './worktrees.js';

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
): Promise<{ branch: string; worktreePath: string; backupPath: string | null }> {
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

  const sourceGitDir = join(sourceRepoPath, '.git');
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

  // Move (never delete) the leftover working-tree files into a backup
  // directory alongside the new bare root. The dirty check above only sees
  // what `git status` reports, which excludes gitignored files (.env,
  // node_modules, local config, etc.) by default — those still physically
  // exist in sourceRepoPath and must not be silently destroyed just because
  // they're untracked-and-ignored rather than untracked-and-dirty.
  const backupRoot = join(dirname(barePath), 'pre-migration-backup');
  let backupPath: string | null = null;

  if (isPathWithin(barePath, sourceRepoPath) || isPathWithin(managedWorktreesPath, sourceRepoPath)) {
    // sourceRepoPath is an ancestor of the new bare/worktrees paths (e.g.
    // imported-in-place, where sourceRepoPath is the whole workspace) — it
    // must keep existing, so only relocate its stray children.
    // `.sproutgit` (and anything under it, including the backup dir itself)
    // must survive untouched.
    const entries = (await readdir(sourceRepoPath)).filter(entry => entry !== '.sproutgit');
    if (entries.length > 0) {
      await mkdir(backupRoot, { recursive: true });
      for (const entry of entries) {
        await moveDir(join(sourceRepoPath, entry), join(backupRoot, entry));
      }
      backupPath = backupRoot;
    }
  } else {
    // sourceRepoPath (e.g. a legacy `workspacePath/root`) is now fully
    // redundant for git purposes, but may still hold gitignored files —
    // relocate the whole directory rather than deleting it.
    await mkdir(backupRoot, { recursive: true });
    const destination = join(backupRoot, basename(sourceRepoPath));
    await moveDir(sourceRepoPath, destination);
    backupPath = destination;
  }

  return { branch, worktreePath, backupPath };
}
