import { describe, it, expect, afterEach } from 'vitest';
import { execSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, realpathSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { createManagedWorktree, addWorktreeForExistingBranch } from '../worktrees.js';

function createNonBareRepo(dir: string): void {
  mkdirSync(dir, { recursive: true });
  execSync('git init -b main', { cwd: dir, stdio: 'ignore' });
  execSync('git config user.email "test@sproutgit.test"', { cwd: dir, stdio: 'ignore' });
  execSync('git config user.name "SproutGit Test"', { cwd: dir, stdio: 'ignore' });
  writeFileSync(join(dir, 'README.md'), '# Test Repo\n');
  execSync('git add .', { cwd: dir, stdio: 'ignore' });
  execSync('git commit -m "initial commit"', { cwd: dir, stdio: 'ignore' });
}

function tempDir(prefix: string): string {
  return realpathSync.native(mkdtempSync(join(tmpdir(), prefix)));
}

// Same class of filesystem-heavy git operations as convert.test.ts — see
// that file's comment on why Windows CI needs a longer timeout.
describe('worktree creation and core.bare inheritance', { timeout: 20_000 }, () => {
  // Each test creates its own root under a fresh tempDir(), but the managed
  // worktrees dir was previously a fixed sibling path (tmpdir()/worktrees)
  // shared by every run and never removed — a leftover directory from a
  // prior (or crashed) run collided with `git worktree add` on the next run
  // ("fatal: '.../worktrees/feature' already exists"). Track and remove the
  // directories created by each test so runs stay isolated.
  const dirsToClean: string[] = [];

  afterEach(() => {
    for (const dir of dirsToClean.splice(0)) {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('creates a working (non-bare) worktree on a plain repo with extensions.worktreeConfig not yet enabled', async () => {
    // Regression for the exact CI failure this fix introduced: a plain repo
    // has exactly one worktree (itself) and extensions.worktreeConfig off.
    // Adding a second worktree must not choke on `git config --worktree`
    // refusing to run without the extension enabled.
    const rootDir = tempDir('sg-worktree-plain-');
    dirsToClean.push(rootDir);
    createNonBareRepo(rootDir);
    const worktreesDir = tempDir('sg-worktree-plain-worktrees-');
    dirsToClean.push(worktreesDir);

    const { worktreePath } = await createManagedWorktree(rootDir, worktreesDir, 'main', 'feature');

    expect(execSync('git status --porcelain', { cwd: worktreePath }).toString().trim()).toBe('');
    expect(execSync('git config --get core.bare', { cwd: worktreePath }).toString().trim()).toBe('false');
  });

  it('creates a working (non-bare) worktree when the repo already has extensions.worktreeConfig and a shared core.bare=true', async () => {
    // Regression for the original bug: a repo (e.g. one already converted to
    // a bare root by an earlier run) has extensions.worktreeConfig on and
    // core.bare=true in the *shared* config. A new linked worktree must not
    // inherit that and come up looking bare.
    const rootDir = tempDir('sg-worktree-bare-inherited-');
    dirsToClean.push(rootDir);
    createNonBareRepo(rootDir);
    execSync('git config extensions.worktreeConfig true', { cwd: rootDir, stdio: 'ignore' });
    execSync('git config core.bare true', { cwd: rootDir, stdio: 'ignore' });
    const worktreesDir = tempDir('sg-worktree-bare-inherited-worktrees-');
    dirsToClean.push(worktreesDir);

    execSync('git branch existing-branch', { cwd: rootDir, stdio: 'ignore' });
    const { worktreePath } = await addWorktreeForExistingBranch(rootDir, worktreesDir, 'existing-branch');

    expect(execSync('git status --porcelain', { cwd: worktreePath }).toString().trim()).toBe('');
    expect(execSync('git config --get core.bare', { cwd: worktreePath }).toString().trim()).toBe('false');
  });
});
