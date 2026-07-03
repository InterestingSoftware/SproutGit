import { describe, it, expect } from 'vitest';
import { execSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, rmSync, realpathSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { isBareRepoPath } from '../bare.js';

function tempDir(prefix: string): string {
  return realpathSync.native(mkdtempSync(join(tmpdir(), prefix)));
}

describe('isBareRepoPath', () => {
  it('returns true for a real bare repo', () => {
    const dir = tempDir('sg-bare-real-');
    execSync('git init --bare', { cwd: dir, stdio: 'ignore' });
    expect(isBareRepoPath(dir)).toBe(true);
    rmSync(dir, { recursive: true, force: true });
  });

  it('returns false for a real non-bare repo (working tree)', () => {
    const dir = tempDir('sg-bare-nonbare-');
    execSync('git init', { cwd: dir, stdio: 'ignore' });
    expect(isBareRepoPath(dir)).toBe(false);
    rmSync(dir, { recursive: true, force: true });
  });

  it('returns false for a plain directory with no git repo at all', () => {
    const dir = tempDir('sg-bare-empty-');
    expect(isBareRepoPath(dir)).toBe(false);
    rmSync(dir, { recursive: true, force: true });
  });

  it('returns false for a nonexistent path', () => {
    const dir = join(tmpdir(), 'sg-bare-does-not-exist-xyz');
    expect(isBareRepoPath(dir)).toBe(false);
  });

  it('returns false for a directory that merely has HEAD/objects/refs but also a nested .git (defensive against a half-converted state)', () => {
    const dir = tempDir('sg-bare-halfway-');
    mkdirSync(join(dir, 'objects'));
    mkdirSync(join(dir, 'refs'));
    mkdirSync(join(dir, '.git'));
    execSync('touch HEAD', { cwd: dir });
    expect(isBareRepoPath(dir)).toBe(false);
    rmSync(dir, { recursive: true, force: true });
  });
});
