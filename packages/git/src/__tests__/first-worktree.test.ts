import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { execSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, rmSync, realpathSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { createFirstManagedWorktree, listWorktrees } from '../worktrees.js';
import { initBareRepo } from '../init.js';

describe('createFirstManagedWorktree', () => {
  let dir: string;
  let rootPath: string;
  let managedWorktreesPath: string;

  beforeEach(async () => {
    dir = realpathSync.native(mkdtempSync(join(tmpdir(), 'sg-first-worktree-test-')));
    rootPath = join(dir, '.sproutgit', 'root');
    managedWorktreesPath = join(dir, '.sproutgit', 'worktrees');
    mkdirSync(rootPath, { recursive: true });
    await initBareRepo(rootPath);
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it('creates a worktree on a brand-new, zero-commit bare repo', async () => {
    const result = await createFirstManagedWorktree(rootPath, managedWorktreesPath, 'main');

    expect(result.branch).toBe('main');
    expect(result.worktreePath).toBe(join(managedWorktreesPath, 'main'));

    // No commits yet, but the branch is checked out — matches a fresh `git init`.
    const status = execSync('git status', { cwd: result.worktreePath }).toString();
    expect(status).toContain('On branch main');
    expect(status).toContain('No commits yet');
  });

  it('is registered as a real worktree of the repo', async () => {
    const result = await createFirstManagedWorktree(rootPath, managedWorktreesPath, 'main');
    const { worktrees } = await listWorktrees(rootPath, managedWorktreesPath);
    const created = worktrees.find(w => w.path === result.worktreePath);
    expect(created?.branch).toBe('main');
    expect(created?.isExternal).toBe(false);
  });

  it('rejects an invalid branch name without touching the filesystem', async () => {
    await expect(createFirstManagedWorktree(rootPath, managedWorktreesPath, '../escape'))
      .rejects.toThrow(/Invalid branch name/);
  });

  it('plain `git worktree add -b <branch> <path> HEAD` fails on the same zero-commit repo — the reason this function exists', () => {
    const wtPath = join(managedWorktreesPath, 'plain-head');
    expect(() => execSync(`git worktree add -b plain-head "${wtPath}" HEAD`, { cwd: rootPath, stdio: 'pipe' }))
      .toThrow(/invalid reference: HEAD/);
  });
});
