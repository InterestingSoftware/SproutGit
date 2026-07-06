import { describe, it, expect } from 'vitest';
import { execSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync, realpathSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { getWorktreeHealth, getWorktreesHealth } from '../health.js';

function tempDir(prefix: string): string {
  return realpathSync.native(mkdtempSync(join(tmpdir(), prefix)));
}

/** Creates a non-bare git repo with a single commit on the default branch. */
function createRepo(dir: string): void {
  mkdirSync(dir, { recursive: true });
  execSync('git init -q', { cwd: dir, stdio: 'ignore' });
  execSync('git config user.email "test@sproutgit.test"', { cwd: dir, stdio: 'ignore' });
  execSync('git config user.name "SproutGit Test"', { cwd: dir, stdio: 'ignore' });
  writeFileSync(join(dir, 'f'), 'hello\n');
  execSync('git add f', { cwd: dir, stdio: 'ignore' });
  execSync('git commit -qm "initial commit"', { cwd: dir, stdio: 'ignore' });
}

describe('getWorktreeHealth', { timeout: 20_000 }, () => {
  it('reports zero ahead/behind and no upstream when there is no remote', async () => {
    const dir = tempDir('sg-health-noremote-');
    createRepo(dir);

    const health = await getWorktreeHealth(dir);

    expect(health.worktreePath).toBe(dir);
    expect(health.hasUpstream).toBe(false);
    expect(health.compareRef).toBeNull();
    expect(health.ahead).toBe(0);
    expect(health.behind).toBe(0);
    expect(health.dirtyCount).toBe(0);
    expect(health.lastCommitAt).not.toBeNull();

    rmSync(dir, { recursive: true, force: true });
  });

  it('counts modified and untracked files as dirty', async () => {
    const dir = tempDir('sg-health-dirty-');
    createRepo(dir);
    writeFileSync(join(dir, 'f'), 'changed\n');
    writeFileSync(join(dir, 'untracked'), 'new\n');

    const health = await getWorktreeHealth(dir);

    expect(health.dirtyCount).toBe(2);

    rmSync(dir, { recursive: true, force: true });
  });

  it('computes ahead/behind against the upstream when one is configured', async () => {
    const workspaceDir = tempDir('sg-health-upstream-');
    const remoteDir = join(workspaceDir, 'remote.git');
    const cloneDir = join(workspaceDir, 'clone');

    mkdirSync(remoteDir, { recursive: true });
    execSync('git init -q --bare', { cwd: remoteDir, stdio: 'ignore' });

    const seedDir = join(workspaceDir, 'seed');
    createRepo(seedDir);
    execSync(`git remote add origin "${remoteDir}"`, { cwd: seedDir, stdio: 'ignore' });
    execSync('git push -q origin HEAD:refs/heads/main', { cwd: seedDir, stdio: 'ignore' });

    execSync(`git clone -q -b main "${remoteDir}" "${cloneDir}"`, { stdio: 'ignore' });

    // Advance the remote by one commit the clone hasn't seen yet (behind 1).
    writeFileSync(join(seedDir, 'g'), 'more\n');
    execSync('git add g', { cwd: seedDir, stdio: 'ignore' });
    execSync('git commit -qm "second commit"', { cwd: seedDir, stdio: 'ignore' });
    execSync('git push -q origin HEAD:refs/heads/main', { cwd: seedDir, stdio: 'ignore' });
    execSync('git fetch -q origin', { cwd: cloneDir, stdio: 'ignore' });

    // Add one local commit the remote hasn't seen (ahead 1).
    writeFileSync(join(cloneDir, 'h'), 'local\n');
    execSync('git add h', { cwd: cloneDir, stdio: 'ignore' });
    execSync('git commit -qm "local commit"', { cwd: cloneDir, stdio: 'ignore' });

    const health = await getWorktreeHealth(cloneDir);

    expect(health.hasUpstream).toBe(true);
    expect(health.compareRef).toBe('origin/main');
    expect(health.ahead).toBe(1);
    expect(health.behind).toBe(1);

    rmSync(workspaceDir, { recursive: true, force: true });
  });

  it('falls back to baseRef for ahead/behind when there is no upstream', async () => {
    const dir = tempDir('sg-health-baseref-');
    createRepo(dir);
    execSync('git branch base', { cwd: dir, stdio: 'ignore' });

    writeFileSync(join(dir, 'g'), 'more\n');
    execSync('git add g', { cwd: dir, stdio: 'ignore' });
    execSync('git commit -qm "second commit"', { cwd: dir, stdio: 'ignore' });

    const health = await getWorktreeHealth(dir, 'base');

    expect(health.hasUpstream).toBe(false);
    expect(health.compareRef).toBe('base');
    expect(health.ahead).toBe(1);
    expect(health.behind).toBe(0);

    rmSync(dir, { recursive: true, force: true });
  });
});

describe('getWorktreesHealth', { timeout: 20_000 }, () => {
  it('computes health for every worktree and keys the result by path', async () => {
    const dirA = tempDir('sg-health-batch-a-');
    const dirB = tempDir('sg-health-batch-b-');
    createRepo(dirA);
    createRepo(dirB);

    const result = await getWorktreesHealth([dirA, dirB]);

    expect(Object.keys(result).sort()).toEqual([dirA, dirB].sort());
    expect(result[dirA]?.worktreePath).toBe(dirA);
    expect(result[dirB]?.worktreePath).toBe(dirB);

    rmSync(dirA, { recursive: true, force: true });
    rmSync(dirB, { recursive: true, force: true });
  });

  it('skips a worktree that fails instead of failing the whole batch', async () => {
    const dirA = tempDir('sg-health-batch-ok-');
    createRepo(dirA);
    const missingDir = join(tmpdir(), 'sg-health-does-not-exist');

    const result = await getWorktreesHealth([dirA, missingDir]);

    expect(result[dirA]?.worktreePath).toBe(dirA);
    expect(result[missingDir]).toBeUndefined();

    rmSync(dirA, { recursive: true, force: true });
  });
});
