import { mkdir, rename, rm, cp, readdir } from 'node:fs/promises';
import { basename, dirname, join } from 'node:path';
import { canonicalize, isPathWithin } from '@sproutgit/paths';
import { gitForPath } from './client.js';
import { getWorktreeStatus } from './staging.js';
import { addWorktreeForExistingBranch, listWorktrees } from './worktrees.js';
import { withWorktreeLock } from './worktree-lock.js';

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

function errorCode(error: unknown): string | undefined {
  return typeof error === 'object' && error !== null && 'code' in error ? (error as { code?: string }).code : undefined;
}

function isCrossDeviceError(error: unknown): boolean {
  return errorCode(error) === 'EXDEV';
}

/**
 * True for the specific Windows rename failures caused by the OS/antivirus
 * not having released a just-exited git.exe subprocess's file handles yet —
 * not a bug in this process, just a transient hold on the directory from
 * outside it. This is exactly why graceful-fs/npm/yarn all retry
 * EPERM/EBUSY on Windows renames rather than failing immediately.
 */
function isTransientWindowsRenameError(error: unknown): boolean {
  const code = errorCode(error);
  return code === 'EPERM' || code === 'EBUSY';
}

function delay(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function moveDir(source: string, destination: string): Promise<void> {
  const maxAttempts = 5;
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      await rename(source, destination);
      return;
    } catch (error) {
      if (isCrossDeviceError(error)) {
        await cp(source, destination, { recursive: true, preserveTimestamps: true });
        await rm(source, { recursive: true, force: true });
        return;
      }
      if (isTransientWindowsRenameError(error) && attempt < maxAttempts) {
        await delay(attempt * 150);
        continue;
      }
      throw error;
    }
  }
}

/**
 * Thrown when conversion fails after the point of no return and the
 * automatic rollback itself could not put the source repo back the way it
 * was. The original error is preserved as `.cause`; `sourceRepoPath` and
 * `barePath` are included so the caller can tell the user exactly where to
 * look. This should be rare — rollback only undoes an in-progress directory
 * rename/config write — but if it happens the workspace needs manual repair.
 */
export class ConversionRollbackFailedError extends Error {
  constructor(
    public readonly sourceRepoPath: string,
    public readonly barePath: string,
    public readonly originalError: unknown,
    public readonly rollbackError: unknown,
  ) {
    super(
      `Failed to convert "${sourceRepoPath}" to a bare repo, and the automatic rollback also failed. ` +
      `The repo may be left partially migrated at "${barePath}". Manual repair is required. ` +
      `Original error: ${originalError instanceof Error ? originalError.message : String(originalError)}. ` +
      `Rollback error: ${rollbackError instanceof Error ? rollbackError.message : String(rollbackError)}.`,
      { cause: originalError },
    );
    this.name = 'ConversionRollbackFailedError';
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
 *
 * Safety/atomicity: nothing here is considered "done" until a worktree has
 * actually been checked out for the branch. Up to and including that step,
 * every action taken (moving `.git` to `barePath`, flipping `core.bare`,
 * repairing other worktrees) is recorded so it can be undone. If any of
 * those steps throws, we roll back everything already applied — moving
 * `barePath` back to `sourceGitDir` and clearing any config changes — so a
 * failed conversion leaves the source repo exactly as it was, rather than a
 * bare repo with no worktree and no way back (see incident: root relocated
 * to `.sproutgit/root`, `core.bare` set, ref history disturbed, but no
 * worktree ever checked out because the process aborted partway through).
 * Only after the worktree checkout succeeds do we touch the leftover
 * working-tree files (backup step), since that point is the actual
 * point-of-no-return for this operation.
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

  // From this point on, `barePath` holds the repo and `sourceGitDir` is gone.
  // Anything that throws before the worktree checkout completes must be
  // rolled back by undoing exactly that: restore `core.bare` to `false`
  // (a plain `.git` dir with a live working tree is never bare) *before*
  // moving the directory back, then move it back to `sourceGitDir` — order
  // matters, since after the move `gitForPath(barePath)` no longer points
  // anywhere valid.
  const rollback = async (originalError: unknown): Promise<never> => {
    try {
      try {
        await gitForPath(barePath).raw(['config', 'core.bare', 'false']);
      } catch {
        // If config-writing itself failed, the directory may not even be a
        // valid git dir any more — fall through and still attempt the move
        // back so at least the files aren't left orphaned at `barePath`.
      }
      await moveDir(barePath, sourceGitDir);
    } catch (rollbackError) {
      throw new ConversionRollbackFailedError(sourceRepoPath, barePath, originalError, rollbackError);
    }
    throw originalError;
  };

  const bareGit = gitForPath(barePath);
  try {
    await bareGit.raw(['config', 'core.bare', 'true']);
    try {
      await bareGit.raw(['config', '--unset', 'core.worktree']);
    } catch {
      // Not set — nothing to unset.
    }

    if (otherWorktreePaths.length > 0) {
      await withWorktreeLock(barePath, () => bareGit.raw(['worktree', 'repair', ...otherWorktreePaths]));
    }
  } catch (error) {
    return rollback(error);
  }

  let worktreePath: string;
  try {
    ({ worktreePath } = await addWorktreeForExistingBranch(barePath, managedWorktreesPath, branch));
  } catch (error) {
    return rollback(error);
  }

  // Past this point the worktree checkout has succeeded — the migration is
  // committed and no longer rolled back. Only the (non-destructive, purely
  // additive) backup-relocation of leftover files remains.

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
