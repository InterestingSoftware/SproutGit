import { existsSync } from 'node:fs';
import { IPC } from '@sproutgit/types';
import { getGitInfo, isBareRepoPath } from '@sproutgit/git';
import {
  listWorktrees,
  createManagedWorktree,
  deleteManagedWorktree,
  canonicalize,
} from '@sproutgit/git/worktrees';
import { getCommitGraph, countCommits, listRefs } from '@sproutgit/git/commits';
import {
  getWorktreeStatus,
  stageFiles,
  unstageFiles,
  createCommit,
  checkoutWorktree,
  resetWorktreeBranch,
} from '@sproutgit/git/staging';
import { fetchWorktree, pullWorktree, pushWorktreeBranch, getWorktreePushStatus } from '@sproutgit/git/remote';
import { getDiffFiles, getDiffContent, getWorkingDiff } from '@sproutgit/git/diff';
import { handle } from './handle.js';

/**
 * Root is always bare, so git itself already refuses working-tree operations
 * there. This is defense-in-depth against our own bug: if a worktree path
 * resolves to root by mistake, fail with a clear internal error instead of
 * surfacing git's raw "not a work tree" fatal.
 */
function assertWorkingTreePath(worktreePath: string): void {
  if (isBareRepoPath(worktreePath)) {
    throw new Error(`Refusing to run a working-tree git operation against a bare repo path: ${worktreePath}`);
  }
}

export function registerGitHandlers(): void {
  // ── git info ──────────────────────────────────────────────────────────────
  handle(IPC.GIT_INFO, async () => {
    return getGitInfo();
  });

  // ── worktrees ─────────────────────────────────────────────────────────────
  handle(IPC.GIT_LIST_WORKTREES, async (_e, repoPath: string, managedWorktreesPath?: string) => {
    const result = await listWorktrees(repoPath, managedWorktreesPath);
    return result.worktrees;
  });

  handle(IPC.WORKTREE_CREATE, async (_e, args: {
    rootRepoPath: string;
    managedWorktreesPath: string;
    fromRef: string;
    newBranch: string;
  }) => {
    return createManagedWorktree(
      args.rootRepoPath,
      args.managedWorktreesPath,
      args.fromRef,
      args.newBranch,
    );
  });

  handle(IPC.WORKTREE_DELETE, async (_e, args: {
    rootRepoPath: string;
    managedWorktreesPath?: string;
    worktreePath: string;
    deleteBranch: boolean;
    branchName?: string | null;
  }) => {
    // Validate the path over IPC: only remove worktrees git itself has
    // registered against this repo — never an arbitrary filesystem path.
    // Compare via canonicalize() (realpath, symlink-safe) rather than a plain
    // resolve() so e.g. macOS's /var vs /private/var doesn't cause a
    // legitimately-registered worktree to be refused.
    const { worktrees } = await listWorktrees(args.rootRepoPath, args.managedWorktreesPath);
    const resolvedTarget = canonicalize(args.worktreePath);
    const match = worktrees.find(w => canonicalize(w.path) === resolvedTarget);
    if (!match) {
      throw new Error('Refusing to remove: path is not a registered worktree of this repository.');
    }
    // Defense in depth: never delete the branch of an external worktree,
    // even if the caller asked for it — an external tool owns that branch.
    const deleteBranch = args.deleteBranch && !match.isExternal;
    // Use the matched, git-reported path rather than the caller-supplied one
    // now that we've validated it — avoids passing through an unresolved
    // string with different (but equivalent) casing/symlinks to git.
    return deleteManagedWorktree(args.rootRepoPath, match.path, deleteBranch, args.branchName);
  });

  // ── commits ───────────────────────────────────────────────────────────────
  handle(IPC.GIT_COMMIT_GRAPH, async (_e, args: {
    repoPath: string;
    limit?: number;
    skip?: number;
  }) => {
    const result = await getCommitGraph(args.repoPath, args.limit, args.skip);
    return result.commits;
  });

  handle(IPC.GIT_COUNT_COMMITS, async (_e, repoPath: string) => {
    return countCommits(repoPath);
  });

  handle(IPC.GIT_LIST_REFS, async (_e, repoPath: string) => {
    return listRefs(repoPath);
  });

  // ── staging ───────────────────────────────────────────────────────────────
  handle(IPC.GIT_STATUS, async (_e, worktreePath: string) => {
    assertWorkingTreePath(worktreePath);
    return getWorktreeStatus(worktreePath);
  });

  handle(IPC.GIT_STAGE, async (_e, args: { worktreePath: string; paths: string[] }) => {
    assertWorkingTreePath(args.worktreePath);
    return stageFiles(args.worktreePath, args.paths);
  });

  handle(IPC.GIT_UNSTAGE, async (_e, args: { worktreePath: string; paths: string[] }) => {
    assertWorkingTreePath(args.worktreePath);
    return unstageFiles(args.worktreePath, args.paths);
  });

  handle(IPC.GIT_COMMIT, async (_e, args: { worktreePath: string; message: string }) => {
    assertWorkingTreePath(args.worktreePath);
    return createCommit(args.worktreePath, args.message);
  });

  handle(IPC.GIT_CHECKOUT, async (_e, args: { worktreePath: string; targetRef: string }) => {
    assertWorkingTreePath(args.worktreePath);
    return checkoutWorktree(args.worktreePath, args.targetRef);
  });

  handle(IPC.GIT_RESET, async (_e, args: {
    worktreePath: string;
    targetRef: string;
    mode: 'soft' | 'mixed' | 'hard';
  }) => {
    assertWorkingTreePath(args.worktreePath);
    return resetWorktreeBranch(args.worktreePath, args.targetRef, args.mode);
  });

  // ── remote ────────────────────────────────────────────────────────────────
  handle(IPC.GIT_FETCH, async (_e, worktreePath: string) => {
    // Safe against a bare repo — fetch only touches refs/objects.
    return fetchWorktree(worktreePath);
  });

  handle(IPC.GIT_PULL, async (_e, worktreePath: string) => {
    assertWorkingTreePath(worktreePath);
    return pullWorktree(worktreePath);
  });

  handle(IPC.GIT_PUSH, async (_e, args: { worktreePath: string; remote?: string }) => {
    assertWorkingTreePath(args.worktreePath);
    return pushWorktreeBranch(args.worktreePath, args.remote);
  });

  handle(IPC.GIT_PUSH_STATUS, async (_e, worktreePath: string) => {
    assertWorkingTreePath(worktreePath);
    return getWorktreePushStatus(worktreePath);
  });

  // ── diff ──────────────────────────────────────────────────────────────────
  handle(IPC.GIT_DIFF_FILES, async (_e, args: { repoPath: string; range: string }) => {
    if (!args.repoPath || !existsSync(args.repoPath)) return [];
    const sep = args.range.indexOf('..');
    const [base, commit] = sep !== -1
      ? [args.range.slice(0, sep), args.range.slice(sep + 2)]
      : [null, args.range];
    const result = await getDiffFiles(args.repoPath, commit!, base ?? null);
    return result.files;
  });

  handle(IPC.GIT_DIFF_CONTENT, async (_e, args: {
    repoPath: string;
    range: string;
    file?: string;
  }) => {
    if (!args.repoPath || !existsSync(args.repoPath)) return '';
    const sep = args.range.indexOf('..');
    const [base, commit] = sep !== -1
      ? [args.range.slice(0, sep), args.range.slice(sep + 2)]
      : [null, args.range];
    const result = await getDiffContent(args.repoPath, commit!, base ?? null, args.file ?? null);
    return result.diff;
  });

  handle(IPC.GIT_WORKING_DIFF, async (_e, args: {
    worktreePath: string;
    file?: string;
  }) => {
    if (!args.worktreePath || !existsSync(args.worktreePath)) return '';
    assertWorkingTreePath(args.worktreePath);
    const result = await getWorkingDiff(args.worktreePath, args.file);
    return result.diff;
  });
}
