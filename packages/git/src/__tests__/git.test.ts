import { describe, it, expect, beforeAll } from 'vitest';
import { execSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync, realpathSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { listWorktrees, getCommitGraph, getWorktreeStatus, stageFiles, createCommit, getStagedDiff, getRecentCommitSubjects } from '../index.js';
import { classifyIsExternal } from '../worktrees.js';

/**
 * Creates a bare git repo for testing with an initial commit.
 * Returns the repo path (also the main worktree path).
 * Uses `realpathSync` to resolve macOS /var → /private/var symlinks.
 */
function initTestRepo(): string {
  // Use realpathSync.native to resolve both symlinks (macOS /var→/private/var)
  // and Windows 8.3 short names (RUNNER~1 → runneradmin).
  const dir = realpathSync.native(mkdtempSync(join(tmpdir(), 'sg-git-test-')));

  execSync('git init', { cwd: dir, stdio: 'ignore' });
  execSync('git config user.email "test@sproutgit.test"', { cwd: dir, stdio: 'ignore' });
  execSync('git config user.name "SproutGit Test"', { cwd: dir, stdio: 'ignore' });

  writeFileSync(join(dir, 'README.md'), '# Test Repo\n');
  execSync('git add .', { cwd: dir, stdio: 'ignore' });
  execSync('git commit -m "initial commit"', { cwd: dir, stdio: 'ignore' });

  return dir;
}

describe('worktrees', () => {
  let repoPath: string;

  beforeAll(() => {
    repoPath = initTestRepo();
    return () => rmSync(repoPath, { recursive: true, force: true });
  });

  it('lists the main worktree', async () => {
    const result = await listWorktrees(repoPath);
    expect(result.worktrees).toHaveLength(1);
    expect(result.worktrees[0]?.path).toBe(repoPath);
  });

  it('marks the root worktree as not external even without a managed path', async () => {
    const result = await listWorktrees(repoPath);
    expect(result.worktrees[0]?.isExternal).toBe(false);
  });

  it('classifies a worktree under the managed directory as not external', async () => {
    const managedWorktreesPath = join(repoPath, '.sproutgit', 'worktrees');
    const managedWtPath = join(managedWorktreesPath, 'feature-a');
    mkdirSync(managedWorktreesPath, { recursive: true });
    execSync(`git worktree add -b feature-a "${managedWtPath}"`, { cwd: repoPath, stdio: 'ignore' });

    const result = await listWorktrees(repoPath, managedWorktreesPath);
    const managed = result.worktrees.find(w => w.branch === 'feature-a');
    expect(managed?.isExternal).toBe(false);

    execSync(`git worktree remove --force "${managedWtPath}"`, { cwd: repoPath, stdio: 'ignore' });
  });

  it('classifies a worktree registered outside the managed directory as external', async () => {
    const managedWorktreesPath = join(repoPath, '.sproutgit', 'worktrees');
    const externalDir = realpathSync.native(mkdtempSync(join(tmpdir(), 'sg-git-test-external-')));
    const externalWtPath = join(externalDir, 'claude-worktree');
    execSync(`git worktree add -b claude-adopted "${externalWtPath}"`, { cwd: repoPath, stdio: 'ignore' });

    const result = await listWorktrees(repoPath, managedWorktreesPath);
    const external = result.worktrees.find(w => w.branch === 'claude-adopted');
    expect(external?.isExternal).toBe(true);

    execSync(`git worktree remove --force "${externalWtPath}"`, { cwd: repoPath, stdio: 'ignore' });
    rmSync(externalDir, { recursive: true, force: true });
  });
});

describe('classifyIsExternal', () => {
  it('treats the repo root itself as not external', () => {
    expect(classifyIsExternal('/ws/root', '/ws/root', '/ws/worktrees')).toBe(false);
  });

  it('treats a path under the managed worktrees directory as not external', () => {
    expect(classifyIsExternal('/ws/worktrees/feature-a', '/ws/root', '/ws/worktrees')).toBe(false);
  });

  it('treats a sibling directory that merely shares a prefix as external', () => {
    // "/ws/worktrees-other" must not match the "/ws/worktrees" boundary check.
    expect(classifyIsExternal('/ws/worktrees-other/foo', '/ws/root', '/ws/worktrees')).toBe(true);
  });

  it('treats a path entirely outside the workspace as external', () => {
    expect(classifyIsExternal('/home/user/project/.claude/worktrees/abc', '/ws/root', '/ws/worktrees')).toBe(true);
  });

  it('defaults to not external when no managed path is supplied', () => {
    expect(classifyIsExternal('/anything/at/all', '/ws/root', undefined)).toBe(false);
  });
});

describe('commits', () => {
  let repoPath: string;

  beforeAll(() => {
    repoPath = initTestRepo();
    return () => rmSync(repoPath, { recursive: true, force: true });
  });

  it('returns commit graph with at least one commit', async () => {
    const result = await getCommitGraph(repoPath);
    expect(result.commits.length).toBeGreaterThanOrEqual(1);
    expect(result.commits[0]).toMatchObject({
      hash: expect.any(String),
      subject: 'initial commit',
    });
  });
});

describe('staging', () => {
  let repoPath: string;

  beforeAll(() => {
    repoPath = initTestRepo();
    return () => rmSync(repoPath, { recursive: true, force: true });
  });

  it('reports clean status on a clean repo', async () => {
    const result = await getWorktreeStatus(repoPath);
    expect(result.files).toHaveLength(0);
  });

  it('stages a new file and creates a commit', async () => {
    writeFileSync(join(repoPath, 'hello.txt'), 'hello\n');
    const before = await getWorktreeStatus(repoPath);
    expect(before.files.some(f => f.path === 'hello.txt')).toBe(true);

    await stageFiles(repoPath, ['hello.txt']);
    const after = await getWorktreeStatus(repoPath);
    expect(after.files.some(f => f.staged && f.path === 'hello.txt')).toBe(true);

    const hash = await createCommit(repoPath, 'add hello.txt');
    expect(hash).toBeTruthy();
  });
});

describe('getStagedDiff', () => {
  let repoPath: string;

  beforeAll(() => {
    repoPath = initTestRepo();
    return () => rmSync(repoPath, { recursive: true, force: true });
  });

  it('returns an empty diff when nothing is staged', async () => {
    const diff = await getStagedDiff(repoPath);
    expect(diff.trim()).toBe('');
  });

  it('returns the unified diff of staged changes only', async () => {
    writeFileSync(join(repoPath, 'staged.txt'), 'staged content\n');
    writeFileSync(join(repoPath, 'unstaged.txt'), 'unstaged content\n');
    await stageFiles(repoPath, ['staged.txt']);

    const diff = await getStagedDiff(repoPath);
    expect(diff).toContain('staged.txt');
    expect(diff).toContain('+staged content');
    expect(diff).not.toContain('unstaged.txt');
  });
});

describe('getRecentCommitSubjects', () => {
  let repoPath: string;

  beforeAll(() => {
    repoPath = initTestRepo();
    return () => rmSync(repoPath, { recursive: true, force: true });
  });

  it('returns commit subjects newest first', async () => {
    writeFileSync(join(repoPath, 'a.txt'), 'a\n');
    execSync('git add a.txt', { cwd: repoPath, stdio: 'ignore' });
    execSync('git commit -m "add a.txt"', { cwd: repoPath, stdio: 'ignore' });

    const subjects = await getRecentCommitSubjects(repoPath, 10);
    expect(subjects[0]).toBe('add a.txt');
    expect(subjects).toContain('initial commit');
  });

  it('respects the count limit', async () => {
    const subjects = await getRecentCommitSubjects(repoPath, 1);
    expect(subjects).toHaveLength(1);
    expect(subjects[0]).toBe('add a.txt');
  });
});
