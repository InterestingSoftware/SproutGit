import { existsSync } from 'node:fs';
import { BrowserWindow } from 'electron';
import { IPC, type WorktreeDeleteResult } from '@sproutgit/types';
import type { ConfigDb } from '@sproutgit/database';
import { getGitInfo, isBareRepoPath } from '@sproutgit/git';
import { listWorktrees, restoreDeletedWorktree } from '@sproutgit/git/worktrees';
import { getCommitGraph, countCommits, listRefs } from '@sproutgit/git/commits';
import { getWorktreesHealth } from '@sproutgit/git/health';
import {
  getWorktreeStatus,
  stageFiles,
  unstageFiles,
  stageHunk,
  unstageHunk,
  createCommit,
  checkoutWorktree,
  resetWorktreeBranch,
} from '@sproutgit/git/staging';
import { fetchWorktree, pullWorktree, pushWorktreeBranch, getWorktreePushStatus } from '@sproutgit/git/remote';
import { getDiffFiles, getDiffContent, getWorkingDiff, getUnstagedFileDiff, getStagedDiff } from '@sproutgit/git/diff';
import { createStash, listStashes, applyStash, popStash, dropStash } from '@sproutgit/git/stash';
import { cherryPickCommit } from '@sproutgit/git/cherry-pick';
import { getConflictFileContent } from '@sproutgit/git/conflicts';
import { handle } from './handle.js';
import { createWorktreeWithHooks, removeWorktreeWithHooks } from '../worktree-lifecycle.js';

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

export function registerGitHandlers(configDb: ConfigDb): void {
  // ── git info ──────────────────────────────────────────────────────────────
  handle(IPC.GIT_INFO, async () => {
    return getGitInfo();
  });

  // ── worktrees ─────────────────────────────────────────────────────────────
  handle(IPC.GIT_LIST_WORKTREES, async (_e, repoPath: string, managedWorktreesPath?: string) => {
    const result = await listWorktrees(repoPath, managedWorktreesPath);
    return result.worktrees;
  });

  // Runs the full create lifecycle (before/after_worktree_create hooks,
  // issue-ref provenance) — see worktree-lifecycle.ts. The MCP
  // create_worktree tool goes through the exact same function.
  handle(IPC.WORKTREE_CREATE, async (_e, args: {
    workspacePath: string;
    rootRepoPath: string;
    managedWorktreesPath: string;
    fromRef: string;
    newBranch: string;
    initiatingWorktreePath?: string | null;
    issueRef?: string | null;
    issueTitle?: string | null;
    orphan?: boolean;
  }) => {
    return createWorktreeWithHooks(args, () => BrowserWindow.fromWebContents(_e.sender), configDb);
  });

  // Runs the full remove lifecycle (before/after_worktree_remove hooks,
  // terminal cleanup, path-containment validation) — see
  // worktree-lifecycle.ts. The MCP remove_worktree tool goes through the
  // exact same function.
  handle(IPC.WORKTREE_DELETE, async (_e, args: {
    workspacePath: string;
    rootRepoPath: string;
    managedWorktreesPath?: string;
    worktreePath: string;
    deleteBranch: boolean;
    branchName?: string | null;
    initiatingWorktreePath?: string | null;
    afterRemoveWorktreePath?: string | null;
  }) => {
    return removeWorktreeWithHooks(args, () => BrowserWindow.fromWebContents(_e.sender), configDb);
  });

  // Reverses a WORKTREE_DELETE within the toast's undo window — see
  // restoreDeletedWorktree's doc comment for why this is a direct restore
  // rather than routed back through the create lifecycle/hooks.
  handle(IPC.WORKTREE_RESTORE, async (_e, args: { rootRepoPath: string; deleted: WorktreeDeleteResult; managedWorktreesPath?: string }) => {
    await restoreDeletedWorktree(args.rootRepoPath, args.deleted, args.managedWorktreesPath);
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

  // ── worktree health (sidebar ahead/behind, dirty count, last-commit age) ──
  handle(IPC.WORKTREE_HEALTH_BATCH, async (_e, args: { repoPath: string; worktreePaths: string[] }) => {
    // Ahead/behind falls back to the repo's default remote branch for
    // worktrees whose branch has no upstream configured.
    const baseRef = await listRefs(args.repoPath)
      .then(refs => refs.defaultRemoteBranch ?? null)
      .catch(() => null);
    return getWorktreesHealth(args.worktreePaths, baseRef);
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

  handle(IPC.GIT_STAGE_HUNK, async (_e, args: {
    worktreePath: string;
    filePath: string;
    hunkIndex: number;
    lineIndices?: number[] | null;
  }) => {
    assertWorkingTreePath(args.worktreePath);
    return stageHunk(args.worktreePath, args.filePath, args.hunkIndex, args.lineIndices);
  });

  handle(IPC.GIT_UNSTAGE_HUNK, async (_e, args: {
    worktreePath: string;
    filePath: string;
    hunkIndex: number;
    lineIndices?: number[] | null;
  }) => {
    assertWorkingTreePath(args.worktreePath);
    return unstageHunk(args.worktreePath, args.filePath, args.hunkIndex, args.lineIndices);
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

  handle(IPC.GIT_UNSTAGED_FILE_DIFF, async (_e, args: { worktreePath: string; file: string }) => {
    if (!args.worktreePath || !existsSync(args.worktreePath)) return '';
    assertWorkingTreePath(args.worktreePath);
    return getUnstagedFileDiff(args.worktreePath, args.file);
  });

  handle(IPC.GIT_STAGED_FILE_DIFF, async (_e, args: { worktreePath: string; file?: string }) => {
    if (!args.worktreePath || !existsSync(args.worktreePath)) return '';
    assertWorkingTreePath(args.worktreePath);
    return getStagedDiff(args.worktreePath, args.file ?? null);
  });

  // ── stash ─────────────────────────────────────────────────────────────────
  handle(IPC.GIT_STASH_CREATE, async (_e, args: { worktreePath: string; message?: string }) => {
    assertWorkingTreePath(args.worktreePath);
    return createStash(args.worktreePath, args.message);
  });

  handle(IPC.GIT_STASH_LIST, async (_e, worktreePath: string) => {
    assertWorkingTreePath(worktreePath);
    return listStashes(worktreePath);
  });

  handle(IPC.GIT_STASH_APPLY, async (_e, args: { worktreePath: string; ref: string }) => {
    assertWorkingTreePath(args.worktreePath);
    return applyStash(args.worktreePath, args.ref);
  });

  handle(IPC.GIT_STASH_POP, async (_e, args: { worktreePath: string; ref: string }) => {
    assertWorkingTreePath(args.worktreePath);
    return popStash(args.worktreePath, args.ref);
  });

  handle(IPC.GIT_STASH_DROP, async (_e, args: { worktreePath: string; ref: string }) => {
    assertWorkingTreePath(args.worktreePath);
    return dropStash(args.worktreePath, args.ref);
  });

  // ── cherry-pick ───────────────────────────────────────────────────────────
  handle(IPC.GIT_CHERRY_PICK, async (_e, args: { worktreePath: string; sha: string }) => {
    assertWorkingTreePath(args.worktreePath);
    return cherryPickCommit(args.worktreePath, args.sha);
  });

  // ── conflicts ─────────────────────────────────────────────────────────────
  handle(IPC.GIT_CONFLICT_CONTENT, async (_e, args: { worktreePath: string; relativePath: string }) => {
    assertWorkingTreePath(args.worktreePath);
    return getConflictFileContent(args.worktreePath, args.relativePath);
  });
}
