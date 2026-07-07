import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import { execSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync, realpathSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { createManagedWorktree, deleteManagedWorktree } from '@sproutgit/git';
import type { McpServerContext } from '../context.js';
import {
  listWorktreesHandler,
  getWorkspaceInfoHandler,
  getWorktreeStatusHandler,
  getWorktreeDiffHandler,
  createWorktreeHandler,
  removeWorktreeHandler,
  reportSessionDoneHandler,
  MUTATING_TOOLS_DISABLED_MESSAGE,
} from '../tools.js';

/** Same pattern as packages/git/src/__tests__/git.test.ts: a real bare-ish repo on disk. */
function initTestRepo(): string {
  const dir = realpathSync.native(mkdtempSync(join(tmpdir(), 'sg-mcp-test-')));
  execSync('git init', { cwd: dir, stdio: 'ignore' });
  execSync('git config user.email "test@sproutgit.test"', { cwd: dir, stdio: 'ignore' });
  execSync('git config user.name "SproutGit Test"', { cwd: dir, stdio: 'ignore' });
  writeFileSync(join(dir, 'README.md'), '# Test Repo\n');
  execSync('git add .', { cwd: dir, stdio: 'ignore' });
  execSync('git commit -m "initial commit"', { cwd: dir, stdio: 'ignore' });
  return dir;
}

function firstText(result: { content: Array<{ type: string; text?: string }> }): string {
  const block = result.content[0];
  if (!block || block.type !== 'text' || typeof block.text !== 'string') throw new Error('expected text content block');
  return block.text;
}

describe('mcp tool handlers', () => {
  let repoPath: string;
  let managedWorktreesPath: string;
  let context: McpServerContext;
  let mutatingEnabled: boolean;
  let reportSessionDoneMock: ReturnType<typeof vi.fn<McpServerContext['reportSessionDone']>>;

  beforeAll(() => {
    repoPath = initTestRepo();
    managedWorktreesPath = join(repoPath, '.sproutgit', 'worktrees');
    mkdirSync(managedWorktreesPath, { recursive: true });
    mutatingEnabled = false;
    reportSessionDoneMock = vi.fn().mockResolvedValue(undefined);
    context = {
      workspacePath: repoPath,
      gitRepoPath: repoPath,
      managedWorktreesPath,
      mutatingToolsEnabled: () => mutatingEnabled,
      // Plain pass-throughs to @sproutgit/git — this package's tests exercise
      // the tool logic in isolation from the host app's hook/provenance
      // orchestration (app/src/main/worktree-lifecycle.ts), which is
      // covered by its own tests instead.
      createWorktree: args => createManagedWorktree(repoPath, managedWorktreesPath, args.fromRef, args.newBranch),
      removeWorktree: async args => { await deleteManagedWorktree(repoPath, args.worktreePath, args.deleteBranch, args.branchName ?? null); },
      reportSessionDone: reportSessionDoneMock,
      // Hooks are covered in their own describe block below with a
      // purpose-built in-memory context — these throw so a hook test that
      // forgets to override one fails loudly instead of silently no-op-ing.
      listHooks: () => { throw new Error('not implemented in this context'); },
      listHookRuns: () => { throw new Error('not implemented in this context'); },
      createLocalHook: () => { throw new Error('not implemented in this context'); },
      updateLocalHook: () => { throw new Error('not implemented in this context'); },
      deleteLocalHook: () => { throw new Error('not implemented in this context'); },
      toggleLocalHook: () => { throw new Error('not implemented in this context'); },
      runHook: () => { throw new Error('not implemented in this context'); },
    };
  });

  afterAll(() => {
    rmSync(repoPath, { recursive: true, force: true });
  });

  it('list_worktrees returns the root worktree', async () => {
    const result = await listWorktreesHandler(context);
    const parsed = JSON.parse(firstText(result));
    expect(parsed).toHaveLength(1);
    expect(parsed[0].path).toBe(repoPath);
  });

  it('get_workspace_info reports paths and worktree count', async () => {
    const result = await getWorkspaceInfoHandler(context);
    const parsed = JSON.parse(firstText(result));
    expect(parsed).toEqual({
      workspacePath: repoPath,
      gitRepoPath: repoPath,
      managedWorktreesPath,
      worktreeCount: 1,
    });
  });

  it('get_worktree_status returns status for a known worktree', async () => {
    writeFileSync(join(repoPath, 'untracked.txt'), 'hello\n');
    const result = await getWorktreeStatusHandler(context, { worktreePath: repoPath });
    const parsed = JSON.parse(firstText(result));
    expect(parsed.worktreePath).toBe(repoPath);
    expect(parsed.files.some((f: { path: string }) => f.path === 'untracked.txt')).toBe(true);
  });

  it('get_worktree_status rejects a path that is not a known worktree', async () => {
    const result = await getWorktreeStatusHandler(context, { worktreePath: '/not/a/worktree' });
    expect(result.isError).toBe(true);
    expect(firstText(result)).toMatch(/not a known worktree/);
  });

  it('get_worktree_diff returns the unified diff for uncommitted changes', async () => {
    writeFileSync(join(repoPath, 'README.md'), '# Test Repo\n\nchanged.\n');
    const result = await getWorktreeDiffHandler(context, { worktreePath: repoPath });
    const parsed = JSON.parse(firstText(result));
    expect(parsed.filePath).toBeNull();
    expect(parsed.diff).toMatch(/README\.md/);
    expect(parsed.diff).toMatch(/changed\./);
  });

  it('get_worktree_diff scopes to a single file when filePath is given', async () => {
    const result = await getWorktreeDiffHandler(context, { worktreePath: repoPath, filePath: 'README.md' });
    const parsed = JSON.parse(firstText(result));
    expect(parsed.filePath).toBe('README.md');
  });

  it('get_worktree_diff rejects a path that is not a known worktree', async () => {
    const result = await getWorktreeDiffHandler(context, { worktreePath: '/not/a/worktree' });
    expect(result.isError).toBe(true);
    expect(firstText(result)).toMatch(/not a known worktree/);
  });

  it('report_session_done forwards the call to context.reportSessionDone and acknowledges', async () => {
    reportSessionDoneMock.mockClear();
    const result = await reportSessionDoneHandler(context, { worktreePath: repoPath, summary: 'Fixed the bug' });
    expect(result.isError).toBeUndefined();
    expect(reportSessionDoneMock).toHaveBeenCalledWith({ worktreePath: repoPath, summary: 'Fixed the bug' });
    const parsed = JSON.parse(firstText(result));
    expect(parsed).toEqual({ acknowledged: true, worktreePath: repoPath });
  });

  it('report_session_done defaults summary to null when omitted', async () => {
    reportSessionDoneMock.mockClear();
    await reportSessionDoneHandler(context, { worktreePath: repoPath });
    expect(reportSessionDoneMock).toHaveBeenCalledWith({ worktreePath: repoPath, summary: null });
  });

  it('report_session_done rejects a path that is not a known worktree', async () => {
    reportSessionDoneMock.mockClear();
    const result = await reportSessionDoneHandler(context, { worktreePath: '/not/a/worktree' });
    expect(result.isError).toBe(true);
    expect(firstText(result)).toMatch(/not a known worktree/);
    expect(reportSessionDoneMock).not.toHaveBeenCalled();
  });

  it('create_worktree refuses when mutating tools are disabled', async () => {
    const result = await createWorktreeHandler(context, { newBranch: 'feature-a', fromRef: 'HEAD' });
    expect(result.isError).toBe(true);
    expect(firstText(result)).toBe(MUTATING_TOOLS_DISABLED_MESSAGE);
  });

  it('remove_worktree refuses when mutating tools are disabled', async () => {
    const result = await removeWorktreeHandler(context, { worktreePath: join(managedWorktreesPath, 'feature-a'), deleteBranch: true, branchName: 'feature-a' });
    expect(result.isError).toBe(true);
    expect(firstText(result)).toBe(MUTATING_TOOLS_DISABLED_MESSAGE);
  });

  describe('with mutating tools enabled', () => {
    beforeAll(() => { mutatingEnabled = true; });
    afterAll(() => { mutatingEnabled = false; });

    it('create_worktree creates a real managed worktree', async () => {
      const result = await createWorktreeHandler(context, { newBranch: 'feature-b', fromRef: 'HEAD' });
      expect(result.isError).toBeUndefined();
      const parsed = JSON.parse(firstText(result));
      expect(parsed.branch).toBe('feature-b');
      expect(parsed.worktreePath).toBe(join(managedWorktreesPath, 'feature-b'));

      const list = await listWorktreesHandler(context);
      const worktrees = JSON.parse(firstText(list));
      expect(worktrees.some((w: { branch: string }) => w.branch === 'feature-b')).toBe(true);
    });

    it('remove_worktree surfaces an error thrown by context.removeWorktree as an error result', async () => {
      // Path-containment validation itself now lives in the injected
      // context.removeWorktree implementation (app/src/main/worktree-
      // lifecycle.ts in the real app — see its own tests), not in this
      // handler. This just confirms the handler converts a thrown error
      // into an isError result rather than letting it propagate.
      const throwingContext: McpServerContext = {
        ...context,
        removeWorktree: async () => { throw new Error("not inside this workspace's managed worktrees directory"); },
      };
      const result = await removeWorktreeHandler(throwingContext, { worktreePath: repoPath, deleteBranch: false });
      expect(result.isError).toBe(true);
      expect(firstText(result)).toMatch(/not inside this workspace's managed worktrees directory/);
    });

    it('remove_worktree requires branchName when deleteBranch is true', async () => {
      const worktreePath = join(managedWorktreesPath, 'feature-b');
      const result = await removeWorktreeHandler(context, { worktreePath, deleteBranch: true });
      expect(result.isError).toBe(true);
      expect(firstText(result)).toMatch(/branchName is required/);
    });

    it('remove_worktree removes a real managed worktree', async () => {
      const worktreePath = join(managedWorktreesPath, 'feature-b');
      const result = await removeWorktreeHandler(context, { worktreePath, deleteBranch: true, branchName: 'feature-b' });
      expect(result.isError).toBeUndefined();

      const list = await listWorktreesHandler(context);
      const worktrees = JSON.parse(firstText(list));
      expect(worktrees.some((w: { branch: string }) => w.branch === 'feature-b')).toBe(false);
    });
  });
});
