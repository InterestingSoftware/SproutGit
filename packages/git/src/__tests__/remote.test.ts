import { describe, it, expect } from 'vitest';
import { execSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync, realpathSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { fetchWorktree } from '../remote.js';

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

// Regression coverage for the "fetch doesn't appear to do anything" report:
// a bare resolved promise looks identical whether there were no remotes,
// nothing new to fetch, or real updates came in. fetchWorktree() must
// distinguish all three so the UI can show an honest, specific message
// instead of a generic "Fetched" that's indistinguishable from a no-op.
//
// Each of these does several real git subprocess spawns for setup (init,
// config, commit, remote add, push, clone) plus the fetch itself under
// test — comfortably under the 5s default on macOS/Linux, but Windows CI
// runners are measurably slower to spawn git processes and have
// intermittently timed out here under load (see convert.test.ts for the
// same pattern). Raise the suite-wide timeout rather than each call site
// individually.
describe('fetchWorktree', { timeout: 20_000 }, () => {
  it('reports hadNoRemotes and skips the fetch entirely when there are no remotes', async () => {
    const dir = tempDir('sg-fetch-noremote-');
    createRepo(dir);

    const summary = await fetchWorktree(dir);

    expect(summary).toEqual({
      worktreePath: dir,
      hadNoRemotes: true,
      updatedRefCount: 0,
      prunedRefCount: 0,
    });

    rmSync(dir, { recursive: true, force: true });
  });

  it('reports zero updated/pruned refs when already up to date', async () => {
    const workspaceDir = tempDir('sg-fetch-uptodate-');
    const remoteDir = join(workspaceDir, 'remote.git');
    const cloneDir = join(workspaceDir, 'clone');

    mkdirSync(remoteDir, { recursive: true });
    execSync('git init -q --bare', { cwd: remoteDir, stdio: 'ignore' });

    const seedDir = join(workspaceDir, 'seed');
    createRepo(seedDir);
    execSync(`git remote add origin "${remoteDir}"`, { cwd: seedDir, stdio: 'ignore' });
    execSync('git push -q origin HEAD', { cwd: seedDir, stdio: 'ignore' });

    execSync(`git clone -q "${remoteDir}" "${cloneDir}"`, { stdio: 'ignore' });

    const summary = await fetchWorktree(cloneDir);

    expect(summary.hadNoRemotes).toBe(false);
    expect(summary.updatedRefCount).toBe(0);
    expect(summary.prunedRefCount).toBe(0);

    rmSync(workspaceDir, { recursive: true, force: true });
  });

  it('reports the number of updated refs when the remote has new commits', async () => {
    const workspaceDir = tempDir('sg-fetch-updated-');
    const remoteDir = join(workspaceDir, 'remote.git');
    const seedDir = join(workspaceDir, 'seed');
    const cloneDir = join(workspaceDir, 'clone');

    mkdirSync(remoteDir, { recursive: true });
    execSync('git init -q --bare', { cwd: remoteDir, stdio: 'ignore' });

    createRepo(seedDir);
    execSync(`git remote add origin "${remoteDir}"`, { cwd: seedDir, stdio: 'ignore' });
    execSync('git push -q origin HEAD', { cwd: seedDir, stdio: 'ignore' });

    execSync(`git clone -q "${remoteDir}" "${cloneDir}"`, { stdio: 'ignore' });

    // Push a new commit from the seed repo after the clone was made.
    writeFileSync(join(seedDir, 'g'), 'more\n');
    execSync('git add g', { cwd: seedDir, stdio: 'ignore' });
    execSync('git commit -qm "second commit"', { cwd: seedDir, stdio: 'ignore' });
    execSync('git push -q origin HEAD', { cwd: seedDir, stdio: 'ignore' });

    const summary = await fetchWorktree(cloneDir);

    expect(summary.hadNoRemotes).toBe(false);
    expect(summary.updatedRefCount).toBeGreaterThan(0);

    rmSync(workspaceDir, { recursive: true, force: true });
  });

  it('propagates a real error for an unreachable remote instead of swallowing it', async () => {
    const dir = tempDir('sg-fetch-unreachable-');
    createRepo(dir);
    execSync('git remote add origin https://example.invalid/nope.git', { cwd: dir, stdio: 'ignore' });

    await expect(fetchWorktree(dir)).rejects.toThrow(/example\.invalid/);

    rmSync(dir, { recursive: true, force: true });
  });
});
