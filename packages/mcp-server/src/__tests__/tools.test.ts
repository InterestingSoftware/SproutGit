import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { execSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync, realpathSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import type { McpServerContext } from '../context.js';
import {
  listWorktreesHandler,
  getWorkspaceInfoHandler,
  getWorktreeStatusHandler,
  createWorktreeHandler,
  removeWorktreeHandler,
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

  beforeAll(() => {
    repoPath = initTestRepo();
    managedWorktreesPath = join(repoPath, '.sproutgit', 'worktrees');
    mkdirSync(managedWorktreesPath, { recursive: true });
    mutatingEnabled = false;
    context = {
      workspacePath: repoPath,
      gitRepoPath: repoPath,
      managedWorktreesPath,
      mutatingToolsEnabled: () => mutatingEnabled,
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

    it('remove_worktree refuses a path outside the managed worktrees directory', async () => {
      const result = await removeWorktreeHandler(context, { worktreePath: repoPath, deleteBranch: false });
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
