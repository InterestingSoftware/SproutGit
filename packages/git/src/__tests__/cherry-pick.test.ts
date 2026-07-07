import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { execSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync, realpathSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { cherryPickCommit, CherryPickConflictError } from '../cherry-pick.js';

function initTestRepo(): string {
  const dir = realpathSync.native(mkdtempSync(join(tmpdir(), 'sg-cherry-pick-test-')));

  execSync('git init -b main', { cwd: dir, stdio: 'ignore' });
  execSync('git config user.email "test@sproutgit.test"', { cwd: dir, stdio: 'ignore' });
  execSync('git config user.name "SproutGit Test"', { cwd: dir, stdio: 'ignore' });

  writeFileSync(join(dir, 'README.md'), '# Test Repo\n');
  execSync('git add .', { cwd: dir, stdio: 'ignore' });
  execSync('git commit -m "initial commit"', { cwd: dir, stdio: 'ignore' });

  return dir;
}

function commitHash(repoPath: string): string {
  return execSync('git rev-parse HEAD', { cwd: repoPath }).toString().trim();
}

describe('cherryPickCommit', () => {
  let repoPath: string;

  beforeEach(() => {
    repoPath = initTestRepo();
  });

  afterEach(() => {
    rmSync(repoPath, { recursive: true, force: true });
  });

  it('applies a clean cherry-pick from a branch onto main', async () => {
    execSync('git checkout -b feature', { cwd: repoPath, stdio: 'ignore' });
    writeFileSync(join(repoPath, 'feature.txt'), 'feature content\n');
    execSync('git add .', { cwd: repoPath, stdio: 'ignore' });
    execSync('git commit -m "add feature file"', { cwd: repoPath, stdio: 'ignore' });
    const featureSha = commitHash(repoPath);

    execSync('git checkout main', { cwd: repoPath, stdio: 'ignore' });

    await cherryPickCommit(repoPath, featureSha);

    const log = execSync('git log --format=%s -1', { cwd: repoPath }).toString().trim();
    expect(log).toBe('add feature file');

    const status = execSync('git status --porcelain', { cwd: repoPath }).toString();
    expect(status.trim()).toBe('');
  });

  it('aborts and throws CherryPickConflictError when the cherry-pick conflicts', async () => {
    execSync('git checkout -b feature', { cwd: repoPath, stdio: 'ignore' });
    writeFileSync(join(repoPath, 'README.md'), '# Test Repo\nfeature change\n');
    execSync('git add .', { cwd: repoPath, stdio: 'ignore' });
    execSync('git commit -m "conflicting change"', { cwd: repoPath, stdio: 'ignore' });
    const featureSha = commitHash(repoPath);

    execSync('git checkout main', { cwd: repoPath, stdio: 'ignore' });
    writeFileSync(join(repoPath, 'README.md'), '# Test Repo\nmain change\n');
    execSync('git add .', { cwd: repoPath, stdio: 'ignore' });
    execSync('git commit -m "main change"', { cwd: repoPath, stdio: 'ignore' });

    const error = await cherryPickCommit(repoPath, featureSha).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(CherryPickConflictError);
    expect((error as CherryPickConflictError).abortFailed).toBe(false);
    expect((error as CherryPickConflictError).message).toContain('was rolled back');

    // The cherry-pick must be fully rolled back — no in-progress state, no
    // conflict markers left behind, working tree clean.
    const status = execSync('git status --porcelain', { cwd: repoPath }).toString();
    expect(status.trim()).toBe('');

    const content = execSync('cat README.md', { cwd: repoPath }).toString();
    expect(content).toBe('# Test Repo\nmain change\n');

    const log = execSync('git log --format=%s -1', { cwd: repoPath }).toString().trim();
    expect(log).toBe('main change');
  });

  it('propagates non-conflict errors (e.g. an unknown sha) without swallowing them', async () => {
    await expect(cherryPickCommit(repoPath, '0'.repeat(40))).rejects.toSatisfy(
      (err: unknown) => err instanceof Error && !(err instanceof CherryPickConflictError)
    );
  });
});
