import {
  type WorktreeListResult,
  type WorktreeInfo,
  type CreateWorktreeResult,
  validateBranchName,
} from '@sproutgit/types';
import { canonicalize, isPathWithin } from '@sproutgit/paths';
import { normalize } from 'node:path';
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
    // withWorktreeLock's doc comment for the exact git-internal race. Only
    // retry that specific, known-transient failure; anything else propagates
    // immediately so a genuine error isn't masked or silently doubled up.
    let raw: string;
    try {
      raw = await gitForPath(repoPath).raw(['worktree', 'list', '--porcelain']);
    } catch (error) {
      if (!isTransientWorktreeListError(error)) throw error;
      raw = await gitForPath(repoPath).raw(['worktree', 'list', '--porcelain']);
    }
    return { repoPath, worktrees: parseWorktreePorcelain(raw, repoPath, managedWorktreesPath) };
  });
}

/**
 * True only for the specific TOCTOU race in git's own `worktree_lock_reason()`
 * (checks the `locked` marker file exists, then reads it as a separate step —
 * see withWorktreeLock's doc comment). Deliberately narrow: any other error
 * from `git worktree list` should propagate immediately rather than being
 * silently retried and potentially masked.
 */
function isTransientWorktreeListError(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);
  return /failed to read '.*\/locked': no such file or directory/i.test(message);
}

/**
 * A linked worktree must never be bare, but if `extensions.worktreeConfig`
 * is already set on the repo (e.g. left over from a prior migration, or
 * enabled by external tooling), `core.bare` becomes a per-worktree setting —
 * any worktree without its own `config.worktree` override silently inherits
 * `core.bare = true` from the shared config and every working-tree command
 * (`status`, `add`, ...) fails with "this operation must be run in a work
 * tree". Setting it explicitly per-worktree is always correct.
 *
 * `git config --worktree` itself refuses to run once there's more than one
 * worktree unless `extensions.worktreeConfig` is already on (a plain repo
 * gaining its first linked worktree hits exactly that: two worktrees now
 * exist, extension still off) — so enable it first. That's a one-time,
 * repo-wide, backward-compatible flag; safe to set unconditionally.
 */
async function disableBareForWorktree(rootRepoPath: string, worktreePath: string): Promise<void> {
  await gitForPath(rootRepoPath).raw(['config', 'extensions.worktreeConfig', 'true']);
  await gitForPath(worktreePath).raw(['config', '--worktree', 'core.bare', 'false']);
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
  if (!isPathWithin(worktreePath, managedWorktreesPath)) {
    throw new Error('Worktree path must stay within the managed worktrees directory.');
  }

  return withWorktreeLock(rootRepoPath, async () => {
    await gitForPath(rootRepoPath).raw(['worktree', 'add', '-b', newBranch, worktreePath, fromRef]);
    await disableBareForWorktree(rootRepoPath, worktreePath);
    // normalize() ensures consistent path separators on all platforms so the
    // returned path matches what listWorktrees() returns (which also normalizes).
    return { worktreePath: normalize(worktreePath), branch: newBranch, fromRef };
  });
}

/**
 * Creates the very first managed worktree for a brand-new, zero-commit bare
 * repo (e.g. `initBareRepo()` with no clone/import). A freshly `git init
 * --bare`'d repo has no commits, so its `HEAD` is unborn — plain
 * `git worktree add -b <branch> <path> HEAD` fails with `fatal: invalid
 * reference: HEAD` because there's no commit to check out yet. `--orphan`
 * (git 2.38+) creates the worktree on a new unborn branch instead, exactly
 * like a fresh `git init` would, with no starting ref required.
 */
export async function createFirstManagedWorktree(
  rootRepoPath: string,
  managedWorktreesPath: string,
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
  if (!isPathWithin(worktreePath, managedWorktreesPath)) {
    throw new Error('Worktree path must stay within the managed worktrees directory.');
  }

  return withWorktreeLock(rootRepoPath, async () => {
    await gitForPath(rootRepoPath).raw(['worktree', 'add', '--orphan', '-b', newBranch, worktreePath]);
    await disableBareForWorktree(rootRepoPath, worktreePath);
    return { worktreePath: normalize(worktreePath), branch: newBranch, fromRef: newBranch };
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

  if (!isPathWithin(worktreePath, managedWorktreesPath)) {
    throw new Error('Worktree path must stay within the managed worktrees directory.');
  }

  return withWorktreeLock(rootRepoPath, async () => {
    await gitForPath(rootRepoPath).raw(['worktree', 'add', worktreePath, branch]);
    await disableBareForWorktree(rootRepoPath, worktreePath);
    return { worktreePath: normalize(worktreePath), branch, fromRef: branch };
  });
}

/**
 * Removes a managed worktree and optionally deletes its branch.
 *
 * @param branchName - The exact branch name to delete. Must be provided when
 *   `deleteBranch` is true; deriving it from the path would be incorrect for
 *   branches whose names contain `/` (e.g. `feature/my-thing`).
 * @param managedWorktreesPath - Defense in depth, mirroring
 *   `createManagedWorktree`/`addWorktreeForExistingBranch`: when supplied,
 *   `worktreePath` must resolve inside it or the call is rejected before
 *   touching git. Callers must omit this for worktrees they've already
 *   classified as external (registered with git but outside the managed
 *   directory) — removing those is intentionally supported, only deleting
 *   their branch is defended against elsewhere.
 *
 *   Unlike the create-path checks (which compare two locally-constructed
 *   strings), `worktreePath` here typically comes from git's own
 *   realpath-based `worktree list` output while `managedWorktreesPath` is
 *   built locally — so this must canonicalize both sides (see
 *   `isWithinCanonical`) or it spuriously rejects legitimate deletions on
 *   platforms where the two disagree on symlinks (e.g. macOS's /var vs
 *   /private/var).
 */
export async function deleteManagedWorktree(
  rootRepoPath: string,
  worktreePath: string,
  deleteBranch = true,
  branchName?: string | null,
  managedWorktreesPath?: string
): Promise<void> {
  if (managedWorktreesPath && !isWithinCanonical(worktreePath, managedWorktreesPath)) {
    throw new Error('Worktree path must stay within the managed worktrees directory.');
  }

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
