import { describe, it, expect, beforeAll } from 'vitest';
import { execSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync, realpathSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { getWorktreeStatus } from '../staging.js';
import { getConflictFileContent } from '../conflicts.js';

function delay(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

/**
 * Removes `dir`, retrying on Windows' transient EBUSY/EPERM — a spawned git
 * child process (e.g. from a failed `git show`) can hold the directory
 * handle open for a moment past the point its promise settles. Same class
 * of race e2e/helpers.ts's `rmWithRetry` guards against.
 */
async function rmWithRetry(dir: string, attempts = 10): Promise<void> {
  for (let attempt = 1; attempt <= attempts; attempt++) {
    try {
      rmSync(dir, { recursive: true, force: true });
      return;
    } catch (err) {
      const code = (err as NodeJS.ErrnoException).code;
      if (attempt === attempts || (code !== 'EBUSY' && code !== 'EPERM')) throw err;
      await delay(100 * attempt);
    }
  }
}

function initTestRepo(): string {
  const dir = realpathSync.native(mkdtempSync(join(tmpdir(), 'sg-git-conflict-test-')));

  execSync('git init', { cwd: dir, stdio: 'ignore' });
  execSync('git config user.email "test@sproutgit.test"', { cwd: dir, stdio: 'ignore' });
  execSync('git config user.name "SproutGit Test"', { cwd: dir, stdio: 'ignore' });

  writeFileSync(join(dir, 'conflict.txt'), 'base\n');
  execSync('git add .', { cwd: dir, stdio: 'ignore' });
  execSync('git commit -m "base commit"', { cwd: dir, stdio: 'ignore' });

  return dir;
}

/** Produces a real merge conflict on conflict.txt: main vs. feature. */
function createConflict(repoPath: string): void {
  execSync('git checkout -b feature', { cwd: repoPath, stdio: 'ignore' });
  writeFileSync(join(repoPath, 'conflict.txt'), 'feature change\n');
  execSync('git commit -am "feature change"', { cwd: repoPath, stdio: 'ignore' });

  execSync('git checkout -', { cwd: repoPath, stdio: 'ignore' });
  writeFileSync(join(repoPath, 'conflict.txt'), 'main change\n');
  execSync('git commit -am "main change"', { cwd: repoPath, stdio: 'ignore' });

  // Non-zero exit is expected here — the merge stops with a conflict.
  try {
    execSync('git merge feature', { cwd: repoPath, stdio: 'ignore' });
  } catch { /* expected */ }
}

describe('conflict detection', () => {
  let repoPath: string;

  beforeAll(() => {
    repoPath = initTestRepo();
    createConflict(repoPath);
    return () => rmWithRetry(repoPath);
  });

  it('flags the unmerged path as conflicted with a UU status', async () => {
    const result = await getWorktreeStatus(repoPath);
    const entry = result.files.find(f => f.path === 'conflict.txt');
    expect(entry?.conflicted).toBe(true);
    expect(entry?.indexStatus).toBe('U');
    expect(entry?.workTreeStatus).toBe('U');
  });

  it('does not flag ordinary modifications as conflicted', async () => {
    const clean = initTestRepo();
    try {
      writeFileSync(join(clean, 'conflict.txt'), 'a plain edit\n');
      const result = await getWorktreeStatus(clean);
      const entry = result.files.find(f => f.path === 'conflict.txt');
      expect(entry?.conflicted).toBe(false);
    } finally {
      await rmWithRetry(clean);
    }
  });

  it('reads base/ours/theirs blobs from the index stages', async () => {
    const content = await getConflictFileContent(repoPath, 'conflict.txt');
    expect(content.base).toEqual({ exists: true, content: 'base' });
    expect(content.ours).toEqual({ exists: true, content: 'main change' });
    expect(content.theirs).toEqual({ exists: true, content: 'feature change' });
  });

  it('reports a missing base stage for a both-added (AA) conflict', async () => {
    execSync('git merge --abort', { cwd: repoPath, stdio: 'ignore' });
    execSync('git checkout feature', { cwd: repoPath, stdio: 'ignore' });
    writeFileSync(join(repoPath, 'both-added.txt'), 'feature version\n');
    execSync('git add both-added.txt', { cwd: repoPath, stdio: 'ignore' });
    execSync('git commit -m "add both-added.txt on feature"', { cwd: repoPath, stdio: 'ignore' });

    execSync('git checkout -', { cwd: repoPath, stdio: 'ignore' });
    writeFileSync(join(repoPath, 'both-added.txt'), 'main version\n');
    execSync('git add both-added.txt', { cwd: repoPath, stdio: 'ignore' });
    execSync('git commit -m "add both-added.txt on main"', { cwd: repoPath, stdio: 'ignore' });

    try {
      execSync('git merge feature', { cwd: repoPath, stdio: 'ignore' });
    } catch { /* expected */ }

    const content = await getConflictFileContent(repoPath, 'both-added.txt');
    expect(content.base.exists).toBe(false);
    expect(content.ours).toEqual({ exists: true, content: 'main version' });
    expect(content.theirs).toEqual({ exists: true, content: 'feature version' });

    execSync('git merge --abort', { cwd: repoPath, stdio: 'ignore' });
  });

  it('propagates an unrelated git failure instead of reporting it as a missing stage', async () => {
    const notARepo = realpathSync.native(mkdtempSync(join(tmpdir(), 'sg-git-not-a-repo-')));
    try {
      await expect(getConflictFileContent(notARepo, 'conflict.txt')).rejects.toThrow();
    } finally {
      await rmWithRetry(notARepo);
    }
  });
});
