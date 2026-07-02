import { describe, it, expect } from 'vitest';
import { execSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync, realpathSync, existsSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { convertToBareWithWorktree, DirtyWorkingTreeError, DetachedHeadError } from '../convert.js';
import { listWorktrees } from '../worktrees.js';

/** Creates a non-bare git repo with a single commit on the default branch. */
function createNonBareRepo(dir: string): void {
  mkdirSync(dir, { recursive: true });
  execSync('git init', { cwd: dir, stdio: 'ignore' });
  execSync('git config user.email "test@sproutgit.test"', { cwd: dir, stdio: 'ignore' });
  execSync('git config user.name "SproutGit Test"', { cwd: dir, stdio: 'ignore' });
  writeFileSync(join(dir, 'README.md'), '# Test Repo\n');
  execSync('git add .', { cwd: dir, stdio: 'ignore' });
  execSync('git commit -m "initial commit"', { cwd: dir, stdio: 'ignore' });
}

function currentBranch(dir: string): string {
  return execSync('git symbolic-ref --short HEAD', { cwd: dir }).toString().trim();
}

function tempDir(prefix: string): string {
  return realpathSync.native(mkdtempSync(join(tmpdir(), prefix)));
}

describe('convertToBareWithWorktree', () => {
  it('converts a clean, standalone repo to bare + worktree', async () => {
    const workspaceDir = tempDir('sg-convert-standalone-');
    const sourceDir = join(workspaceDir, 'root');
    createNonBareRepo(sourceDir);
    const branch = currentBranch(sourceDir);

    const barePath = join(workspaceDir, 'bare');
    const worktreesPath = join(workspaceDir, 'worktrees');
    mkdirSync(worktreesPath, { recursive: true });

    const result = await convertToBareWithWorktree(sourceDir, barePath, worktreesPath);

    expect(result.branch).toBe(branch);
    expect(existsSync(sourceDir)).toBe(false);
    expect(execSync('git config core.bare', { cwd: barePath }).toString().trim()).toBe('true');

    const worktreePath = join(worktreesPath, branch);
    expect(existsSync(join(worktreePath, 'README.md'))).toBe(true);
    expect(currentBranch(worktreePath)).toBe(branch);

    // `git worktree list` on a bare repo also reports the bare repo itself
    // as a `bare` pseudo-entry — listWorktrees() filters that out at the
    // source, so only the real worktree we just added should come back.
    const { worktrees } = await listWorktrees(barePath);
    expect(worktrees).toHaveLength(1);
    expect(worktrees[0]?.branch).toBe(branch);
    expect(worktrees[0]?.path).toBe(worktreePath);

    rmSync(workspaceDir, { recursive: true, force: true });
  });

  it('converts a clean, imported-in-place repo (source is an ancestor of the bare path)', async () => {
    const workspaceDir = tempDir('sg-convert-inplace-');
    createNonBareRepo(workspaceDir);
    const branch = currentBranch(workspaceDir);

    // Mirrors importInPlace(): .sproutgit/worktrees already exists as a
    // sibling of the working files before conversion runs.
    const sproutDir = join(workspaceDir, '.sproutgit');
    const worktreesPath = join(sproutDir, 'worktrees');
    const barePath = join(sproutDir, 'root');
    mkdirSync(worktreesPath, { recursive: true });

    const result = await convertToBareWithWorktree(workspaceDir, barePath, worktreesPath);

    expect(result.branch).toBe(branch);
    // The workspace directory itself must survive — it holds .sproutgit.
    expect(existsSync(workspaceDir)).toBe(true);
    expect(existsSync(join(workspaceDir, 'README.md'))).toBe(false);
    expect(existsSync(join(workspaceDir, '.git'))).toBe(false);
    expect(execSync('git config core.bare', { cwd: barePath }).toString().trim()).toBe('true');

    const worktreePath = join(worktreesPath, branch);
    expect(existsSync(join(worktreePath, 'README.md'))).toBe(true);

    // Nothing left over besides .sproutgit.
    expect(readdirSync(workspaceDir)).toEqual(['.sproutgit']);

    rmSync(workspaceDir, { recursive: true, force: true });
  });

  it('repairs a pre-existing linked worktree after the main repo moves and goes bare', async () => {
    const workspaceDir = tempDir('sg-convert-repair-');
    const sourceDir = join(workspaceDir, 'root');
    createNonBareRepo(sourceDir);
    const branch = currentBranch(sourceDir);

    const worktreesPath = join(workspaceDir, '.sproutgit', 'worktrees');
    mkdirSync(worktreesPath, { recursive: true });

    // Simulate a worktree created before this migration code existed.
    const otherWorktreePath = join(worktreesPath, 'feature-a');
    execSync(`git worktree add -b feature-a "${otherWorktreePath}"`, { cwd: sourceDir, stdio: 'ignore' });

    const barePath = join(workspaceDir, '.sproutgit', 'root');
    await convertToBareWithWorktree(sourceDir, barePath, worktreesPath);

    // The pre-existing worktree must still be usable after the move.
    const status = execSync('git status --porcelain', { cwd: otherWorktreePath }).toString();
    expect(status).toBe('');
    expect(execSync('git symbolic-ref --short HEAD', { cwd: otherWorktreePath }).toString().trim()).toBe('feature-a');

    const { worktrees } = await listWorktrees(barePath);
    const branches = worktrees.map(w => w.branch).filter((b): b is string => b !== null).sort();
    expect(branches).toEqual([branch, 'feature-a'].sort());

    rmSync(workspaceDir, { recursive: true, force: true });
  });

  it('refuses to convert a dirty repo and leaves it untouched', async () => {
    const workspaceDir = tempDir('sg-convert-dirty-');
    const sourceDir = join(workspaceDir, 'root');
    createNonBareRepo(sourceDir);
    writeFileSync(join(sourceDir, 'untracked.txt'), 'oops\n');

    const barePath = join(workspaceDir, 'bare');
    const worktreesPath = join(workspaceDir, 'worktrees');
    mkdirSync(worktreesPath, { recursive: true });

    await expect(convertToBareWithWorktree(sourceDir, barePath, worktreesPath))
      .rejects.toBeInstanceOf(DirtyWorkingTreeError);

    expect(existsSync(join(sourceDir, '.git'))).toBe(true);
    expect(existsSync(join(sourceDir, 'untracked.txt'))).toBe(true);
    expect(existsSync(barePath)).toBe(false);

    rmSync(workspaceDir, { recursive: true, force: true });
  });

  it('refuses to convert a detached-HEAD repo and leaves it untouched', async () => {
    const workspaceDir = tempDir('sg-convert-detached-');
    const sourceDir = join(workspaceDir, 'root');
    createNonBareRepo(sourceDir);
    const sha = execSync('git rev-parse HEAD', { cwd: sourceDir }).toString().trim();
    execSync(`git checkout ${sha}`, { cwd: sourceDir, stdio: 'ignore' });

    const barePath = join(workspaceDir, 'bare');
    const worktreesPath = join(workspaceDir, 'worktrees');
    mkdirSync(worktreesPath, { recursive: true });

    await expect(convertToBareWithWorktree(sourceDir, barePath, worktreesPath))
      .rejects.toBeInstanceOf(DetachedHeadError);

    expect(existsSync(join(sourceDir, '.git'))).toBe(true);
    expect(existsSync(barePath)).toBe(false);

    rmSync(workspaceDir, { recursive: true, force: true });
  });
});
