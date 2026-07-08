import { describe, it, expect } from 'vitest';
import { execSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, realpathSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { createManagedWorktree, addWorktreeForExistingBranch, deleteManagedWorktree, restoreDeletedWorktree } from '../worktrees.js';

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
  it('creates a working (non-bare) worktree on a plain repo with extensions.worktreeConfig not yet enabled', async () => {
    // Regression for the exact CI failure this fix introduced: a plain repo
    // has exactly one worktree (itself) and extensions.worktreeConfig off.
    // Adding a second worktree must not choke on `git config --worktree`
    // refusing to run without the extension enabled.
    const rootDir = tempDir('sg-worktree-plain-');
    createNonBareRepo(rootDir);
    const worktreesDir = join(tempDir('sg-worktree-plain-out-'), 'worktrees');
    mkdirSync(worktreesDir, { recursive: true });

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
    createNonBareRepo(rootDir);
    execSync('git config extensions.worktreeConfig true', { cwd: rootDir, stdio: 'ignore' });
    execSync('git config core.bare true', { cwd: rootDir, stdio: 'ignore' });
    const worktreesDir = join(tempDir('sg-worktree-bare-inherited-out-'), 'worktrees');
    mkdirSync(worktreesDir, { recursive: true });

    execSync('git branch existing-branch', { cwd: rootDir, stdio: 'ignore' });
    const { worktreePath } = await addWorktreeForExistingBranch(rootDir, worktreesDir, 'existing-branch');

    expect(execSync('git status --porcelain', { cwd: worktreePath }).toString().trim()).toBe('');
    expect(execSync('git config --get core.bare', { cwd: worktreePath }).toString().trim()).toBe('false');
  });
});

describe('deleteManagedWorktree path containment', { timeout: 20_000 }, () => {
  it('rejects a worktreePath outside managedWorktreesPath when the caller supplies it, without touching git', async () => {
    const rootDir = tempDir('sg-worktree-delete-root-');
    createNonBareRepo(rootDir);
    const worktreesDir = join(rootDir, '..', 'worktrees');
    mkdirSync(worktreesDir, { recursive: true });
    const outsidePath = tempDir('sg-worktree-delete-outside-');

    await expect(
      deleteManagedWorktree(rootDir, outsidePath, false, null, worktreesDir)
    ).rejects.toThrow('Worktree path must stay within the managed worktrees directory.');

    // Rejected before git ever ran — the unrelated directory must survive untouched.
    expect(existsSync(outsidePath)).toBe(true);
  });
});

describe('deleteManagedWorktree undo capture and restoreDeletedWorktree', { timeout: 20_000 }, () => {
  it('captures the branch SHA before deleting it, and the branch/worktree can be fully restored from it', async () => {
    const rootDir = tempDir('sg-worktree-undo-');
    createNonBareRepo(rootDir);
    const worktreesDir = join(tempDir('sg-worktree-undo-out-'), 'worktrees');
    mkdirSync(worktreesDir, { recursive: true });

    const { worktreePath } = await createManagedWorktree(rootDir, worktreesDir, 'main', 'to-undo');
    writeFileSync(join(worktreePath, 'change.txt'), 'undo me\n');
    execSync('git add change.txt', { cwd: worktreePath, stdio: 'ignore' });
    execSync('git commit -m "commit to preserve"', { cwd: worktreePath, stdio: 'ignore' });
    const expectedSha = execSync('git rev-parse to-undo', { cwd: rootDir }).toString().trim();

    const deleted = await deleteManagedWorktree(rootDir, worktreePath, true, 'to-undo', worktreesDir);

    expect(deleted).toEqual({ worktreePath, branch: 'to-undo', branchSha: expectedSha });
    expect(existsSync(worktreePath)).toBe(false);
    expect(execSync('git branch --list to-undo', { cwd: rootDir }).toString().trim()).toBe('');

    await restoreDeletedWorktree(rootDir, deleted, worktreesDir);

    expect(execSync('git rev-parse to-undo', { cwd: rootDir }).toString().trim()).toBe(expectedSha);
    expect(existsSync(join(worktreePath, 'change.txt'))).toBe(true);
    expect(execSync('git config --get core.bare', { cwd: worktreePath }).toString().trim()).toBe('false');
  });

  it('does not capture a SHA when deleteBranch is false, and restore just re-adds the worktree on the still-existing branch', async () => {
    const rootDir = tempDir('sg-worktree-undo-keepbranch-');
    createNonBareRepo(rootDir);
    const worktreesDir = join(tempDir('sg-worktree-undo-keepbranch-out-'), 'worktrees');
    mkdirSync(worktreesDir, { recursive: true });

    const { worktreePath } = await createManagedWorktree(rootDir, worktreesDir, 'main', 'keep-branch');

    const deleted = await deleteManagedWorktree(rootDir, worktreePath, false, 'keep-branch', worktreesDir);

    expect(deleted).toEqual({ worktreePath, branch: 'keep-branch', branchSha: null });
    // The branch itself was never deleted.
    expect(execSync('git branch --list keep-branch', { cwd: rootDir }).toString().trim()).not.toBe('');

    await restoreDeletedWorktree(rootDir, deleted);

    expect(existsSync(worktreePath)).toBe(true);
    expect(execSync('git config --get core.bare', { cwd: worktreePath }).toString().trim()).toBe('false');
  });

  it('throws when asked to restore a worktree that was removed without a branch', async () => {
    await expect(
      restoreDeletedWorktree('/irrelevant', { worktreePath: '/irrelevant/wt', branch: null, branchSha: null })
    ).rejects.toThrow('Cannot restore a worktree that was removed without a branch.');
  });

  it('throws when the branch is gone and no SHA was captured to recreate it', async () => {
    const rootDir = tempDir('sg-worktree-undo-noshadow-');
    createNonBareRepo(rootDir);

    await expect(
      restoreDeletedWorktree(rootDir, { worktreePath: join(rootDir, '..', 'gone'), branch: 'never-existed', branchSha: null })
    ).rejects.toThrow('Branch "never-existed" no longer exists and no SHA was captured to recreate it.');
  });

  it('rejects a restore whose worktreePath falls outside a supplied managedWorktreesPath, without touching git', async () => {
    // Guards against a renderer echoing back a forged/stale WorktreeDeleteResult
    // over IPC — restoring to an arbitrary filesystem path must be refused
    // just like deleteManagedWorktree refuses to delete one.
    const rootDir = tempDir('sg-worktree-undo-outside-');
    createNonBareRepo(rootDir);
    const worktreesDir = join(tempDir('sg-worktree-undo-outside-managed-'), 'worktrees');
    mkdirSync(worktreesDir, { recursive: true });
    const outsidePath = join(tempDir('sg-worktree-undo-outside-target-'), 'evil');
    execSync('git branch attacker-branch', { cwd: rootDir, stdio: 'ignore' });

    await expect(
      restoreDeletedWorktree(rootDir, { worktreePath: outsidePath, branch: 'attacker-branch', branchSha: null }, worktreesDir)
    ).rejects.toThrow('Worktree path must stay within the managed worktrees directory.');

    expect(existsSync(outsidePath)).toBe(false);
  });
});
