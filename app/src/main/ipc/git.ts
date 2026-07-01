import { existsSync } from 'node:fs';
import { IPC } from '@sproutgit/types';
import { getGitInfo } from '@sproutgit/git';
import {
  listWorktrees,
  createManagedWorktree,
  deleteManagedWorktree,
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

export function registerGitHandlers(): void {
  // ── git info ──────────────────────────────────────────────────────────────
  handle(IPC.GIT_INFO, async () => {
    return getGitInfo();
  });

  // ── worktrees ─────────────────────────────────────────────────────────────
  handle(IPC.GIT_LIST_WORKTREES, async (_e, repoPath: string) => {
    const result = await listWorktrees(repoPath);
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
    worktreePath: string;
    deleteBranch: boolean;
    branchName?: string | null;
  }) => {
    return deleteManagedWorktree(args.rootRepoPath, args.worktreePath, args.deleteBranch, args.branchName);
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
    return getWorktreeStatus(worktreePath);
  });

  handle(IPC.GIT_STAGE, async (_e, args: { worktreePath: string; paths: string[] }) => {
    return stageFiles(args.worktreePath, args.paths);
  });

  handle(IPC.GIT_UNSTAGE, async (_e, args: { worktreePath: string; paths: string[] }) => {
    return unstageFiles(args.worktreePath, args.paths);
  });

  handle(IPC.GIT_COMMIT, async (_e, args: { worktreePath: string; message: string }) => {
    return createCommit(args.worktreePath, args.message);
  });

  handle(IPC.GIT_CHECKOUT, async (_e, args: { worktreePath: string; targetRef: string }) => {
    return checkoutWorktree(args.worktreePath, args.targetRef);
  });

  handle(IPC.GIT_RESET, async (_e, args: {
    worktreePath: string;
    targetRef: string;
    mode: 'soft' | 'mixed' | 'hard';
  }) => {
    return resetWorktreeBranch(args.worktreePath, args.targetRef, args.mode);
  });

  // ── remote ────────────────────────────────────────────────────────────────
  handle(IPC.GIT_FETCH, async (_e, worktreePath: string) => {
    return fetchWorktree(worktreePath);
  });

  handle(IPC.GIT_PULL, async (_e, worktreePath: string) => {
    return pullWorktree(worktreePath);
  });

  handle(IPC.GIT_PUSH, async (_e, args: { worktreePath: string; remote?: string }) => {
    return pushWorktreeBranch(args.worktreePath, args.remote);
  });

  handle(IPC.GIT_PUSH_STATUS, async (_e, worktreePath: string) => {
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
    const result = await getWorkingDiff(args.worktreePath, args.file);
    return result.diff;
  });
}
