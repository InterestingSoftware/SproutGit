import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { execSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync, realpathSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { openWorkspaceDb, eq } from '@sproutgit/database';
import { worktreeMetadata } from '@sproutgit/database/schema/workspace';

const { runTriggerHooksMock } = vi.hoisted(() => ({ runTriggerHooksMock: vi.fn().mockResolvedValue(undefined) }));
vi.mock('../ipc/hooks.js', () => ({ runTriggerHooks: runTriggerHooksMock }));

import { manager } from '../ipc/terminal.js';
import { createWorktreeWithHooks, removeWorktreeWithHooks } from '../worktree-lifecycle.js';

function initTestRepo(): string {
  const dir = realpathSync.native(mkdtempSync(join(tmpdir(), 'sg-wt-lifecycle-test-')));
  execSync('git init', { cwd: dir, stdio: 'ignore' });
  execSync('git config user.email "test@sproutgit.test"', { cwd: dir, stdio: 'ignore' });
  execSync('git config user.name "SproutGit Test"', { cwd: dir, stdio: 'ignore' });
  writeFileSync(join(dir, 'README.md'), '# Test\n');
  execSync('git add .', { cwd: dir, stdio: 'ignore' });
  execSync('git commit -m init', { cwd: dir, stdio: 'ignore' });
  return dir;
}

const FAKE_WINDOW = { webContents: { send: vi.fn() } } as unknown as Electron.BrowserWindow;
const NO_WINDOW = () => null;

describe('worktree-lifecycle', () => {
  let repoPath: string;
  let managedWorktreesPath: string;

  beforeEach(() => {
    repoPath = initTestRepo();
    managedWorktreesPath = join(repoPath, '.sproutgit', 'worktrees');
    mkdirSync(managedWorktreesPath, { recursive: true });
    runTriggerHooksMock.mockClear();
  });

  afterEach(() => {
    rmSync(repoPath, { recursive: true, force: true });
  });

  describe('createWorktreeWithHooks', () => {
    it('creates a real managed worktree', async () => {
      const result = await createWorktreeWithHooks({
        workspacePath: repoPath,
        rootRepoPath: repoPath,
        managedWorktreesPath,
        fromRef: 'HEAD',
        newBranch: 'feature-a',
      }, NO_WINDOW);
      expect(result.branch).toBe('feature-a');
      expect(result.worktreePath).toBe(join(managedWorktreesPath, 'feature-a'));
    });

    it('skips hooks entirely when no window is open for the workspace', async () => {
      await createWorktreeWithHooks({
        workspacePath: repoPath,
        rootRepoPath: repoPath,
        managedWorktreesPath,
        fromRef: 'HEAD',
        newBranch: 'feature-b',
      }, NO_WINDOW);
      expect(runTriggerHooksMock).not.toHaveBeenCalled();
    });

    it('runs before_worktree_create then after_worktree_create, in that order, when a window is open', async () => {
      await createWorktreeWithHooks({
        workspacePath: repoPath,
        rootRepoPath: repoPath,
        managedWorktreesPath,
        fromRef: 'HEAD',
        newBranch: 'feature-c',
        initiatingWorktreePath: repoPath,
      }, () => FAKE_WINDOW);

      expect(runTriggerHooksMock).toHaveBeenCalledTimes(2);
      expect(runTriggerHooksMock.mock.calls[0]![0]).toMatchObject({
        trigger: 'before_worktree_create',
        worktreePath: repoPath,
        initiatingWorktreePath: repoPath,
      });
      expect(runTriggerHooksMock.mock.calls[1]![0]).toMatchObject({
        trigger: 'after_worktree_create',
        worktreePath: join(managedWorktreesPath, 'feature-c'),
        initiatingWorktreePath: repoPath,
      });
    });

    it('records issue-ref provenance when issueRef is provided', async () => {
      const result = await createWorktreeWithHooks({
        workspacePath: repoPath,
        rootRepoPath: repoPath,
        managedWorktreesPath,
        fromRef: 'HEAD',
        newBranch: 'feature-d',
        issueRef: 'ABC-123',
        issueTitle: 'Fix the thing',
      }, NO_WINDOW);

      const db = openWorkspaceDb(join(repoPath, '.sproutgit', 'state.db'));
      const row = db.select().from(worktreeMetadata).where(eq(worktreeMetadata.worktreePath, result.worktreePath)).get();
      db.close();
      expect(row?.issueRef).toBe('ABC-123');
      expect(row?.issueTitle).toBe('Fix the thing');
    });

    it('does not touch worktree_metadata when no issueRef is given', async () => {
      const result = await createWorktreeWithHooks({
        workspacePath: repoPath,
        rootRepoPath: repoPath,
        managedWorktreesPath,
        fromRef: 'HEAD',
        newBranch: 'feature-e',
      }, NO_WINDOW);

      const db = openWorkspaceDb(join(repoPath, '.sproutgit', 'state.db'));
      const row = db.select().from(worktreeMetadata).where(eq(worktreeMetadata.worktreePath, result.worktreePath)).get();
      db.close();
      expect(row).toBeUndefined();
    });
  });

  describe('removeWorktreeWithHooks', () => {
    it('removes a real managed worktree and closes terminals for its path', async () => {
      const created = await createWorktreeWithHooks({
        workspacePath: repoPath,
        rootRepoPath: repoPath,
        managedWorktreesPath,
        fromRef: 'HEAD',
        newBranch: 'to-remove',
      }, NO_WINDOW);

      const closeForPathSpy = vi.spyOn(manager, 'closeForPath').mockImplementation(() => undefined);
      try {
        await removeWorktreeWithHooks({
          workspacePath: repoPath,
          rootRepoPath: repoPath,
          managedWorktreesPath,
          worktreePath: created.worktreePath,
          deleteBranch: true,
          branchName: 'to-remove',
        }, NO_WINDOW);
        expect(closeForPathSpy).toHaveBeenCalledWith(created.worktreePath);
      } finally {
        closeForPathSpy.mockRestore();
      }
    });

    it('runs before_worktree_remove then after_worktree_remove, in that order, when a window is open', async () => {
      const created = await createWorktreeWithHooks({
        workspacePath: repoPath,
        rootRepoPath: repoPath,
        managedWorktreesPath,
        fromRef: 'HEAD',
        newBranch: 'to-remove-2',
      }, NO_WINDOW);
      runTriggerHooksMock.mockClear();
      const closeForPathSpy = vi.spyOn(manager, 'closeForPath').mockImplementation(() => undefined);

      try {
        await removeWorktreeWithHooks({
          workspacePath: repoPath,
          rootRepoPath: repoPath,
          managedWorktreesPath,
          worktreePath: created.worktreePath,
          deleteBranch: true,
          branchName: 'to-remove-2',
          initiatingWorktreePath: repoPath,
          afterRemoveWorktreePath: repoPath,
        }, () => FAKE_WINDOW);

        expect(runTriggerHooksMock).toHaveBeenCalledTimes(2);
        expect(runTriggerHooksMock.mock.calls[0]![0]).toMatchObject({
          trigger: 'before_worktree_remove',
          worktreePath: created.worktreePath,
        });
        expect(runTriggerHooksMock.mock.calls[1]![0]).toMatchObject({
          trigger: 'after_worktree_remove',
          worktreePath: repoPath,
        });
      } finally {
        closeForPathSpy.mockRestore();
      }
    });

    it('throws for a path that is not a registered worktree of this repo, without touching hooks or terminals', async () => {
      const closeForPathSpy = vi.spyOn(manager, 'closeForPath').mockImplementation(() => undefined);
      try {
        await expect(removeWorktreeWithHooks({
          workspacePath: repoPath,
          rootRepoPath: repoPath,
          managedWorktreesPath,
          worktreePath: '/not/a/real/worktree',
          deleteBranch: false,
        }, () => FAKE_WINDOW)).rejects.toThrow(/not a registered worktree/);
        expect(closeForPathSpy).not.toHaveBeenCalled();
        expect(runTriggerHooksMock).not.toHaveBeenCalled();
      } finally {
        closeForPathSpy.mockRestore();
      }
    });
  });
});
