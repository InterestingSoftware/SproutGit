import { describe, it, expect, vi, beforeEach } from 'vitest';
import { execSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync, realpathSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

const { renameMock } = vi.hoisted(() => ({ renameMock: vi.fn() }));
vi.mock('node:fs/promises', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:fs/promises')>();
  return { ...actual, rename: (...a: Parameters<typeof actual.rename>) => renameMock(actual.rename, ...a) };
});

import { convertToBareWithWorktree } from '../convert.js';

function eperm(): NodeJS.ErrnoException {
  return Object.assign(new Error('EPERM: operation not permitted, rename'), { code: 'EPERM' });
}

function createNonBareRepo(dir: string): void {
  mkdirSync(dir, { recursive: true });
  execSync('git init', { cwd: dir, stdio: 'ignore' });
  execSync('git config user.email "test@sproutgit.test"', { cwd: dir, stdio: 'ignore' });
  execSync('git config user.name "SproutGit Test"', { cwd: dir, stdio: 'ignore' });
  writeFileSync(join(dir, 'README.md'), '# Test Repo\n');
  execSync('git add .', { cwd: dir, stdio: 'ignore' });
  execSync('git commit -m "initial commit"', { cwd: dir, stdio: 'ignore' });
}

function tempDir(prefix: string): string {
  return realpathSync.native(mkdtempSync(join(tmpdir(), prefix)));
}

describe('moveDir retry on Windows EPERM/EBUSY (moving .git to the bare path)', () => {
  let workspaceDir: string;
  let sourceDir: string;
  let barePath: string;
  let worktreesPath: string;

  beforeEach(() => {
    vi.clearAllMocks();
    workspaceDir = tempDir('sg-convert-eperm-');
    sourceDir = join(workspaceDir, 'root');
    createNonBareRepo(sourceDir);
    barePath = join(workspaceDir, 'bare');
    worktreesPath = join(workspaceDir, 'worktrees');
    mkdirSync(worktreesPath, { recursive: true });
    // Default: every rename call passes through to the real implementation.
    renameMock.mockImplementation((real: typeof import('node:fs/promises').rename, ...a: Parameters<typeof real>) => real(...a));
  });

  it('retries a transient EPERM on the `.git` move and succeeds', async () => {
    let gitMoveAttempts = 0;
    renameMock.mockImplementation((real: typeof import('node:fs/promises').rename, ...a: Parameters<typeof real>) => {
      const [source] = a;
      if (typeof source === 'string' && source.endsWith('.git')) {
        gitMoveAttempts++;
        if (gitMoveAttempts <= 2) return Promise.reject(eperm());
      }
      return real(...a);
    });

    const result = await convertToBareWithWorktree(sourceDir, barePath, worktreesPath);

    expect(gitMoveAttempts).toBe(3);
    expect(existsSync(barePath)).toBe(true);
    expect(result.branch).toBeTruthy();

    rmSync(workspaceDir, { recursive: true, force: true });
  });

  it('gives up and propagates the error after repeated EPERM failures on the `.git` move', async () => {
    renameMock.mockImplementation((_real: typeof import('node:fs/promises').rename, ...a: unknown[]) => {
      const [source] = a as [string];
      if (source.endsWith('.git')) return Promise.reject(eperm());
      throw new Error('unexpected rename call before .git move settled');
    });

    await expect(convertToBareWithWorktree(sourceDir, barePath, worktreesPath)).rejects.toThrow(/EPERM/);
    expect(renameMock).toHaveBeenCalledTimes(5);

    rmSync(workspaceDir, { recursive: true, force: true });
  });

  it('does not retry a non-transient rename error', async () => {
    renameMock.mockImplementation((_real: typeof import('node:fs/promises').rename, ...a: unknown[]) => {
      const [source] = a as [string];
      if (source.endsWith('.git')) return Promise.reject(Object.assign(new Error('nope'), { code: 'ENOENT' }));
      throw new Error('unexpected rename call before .git move settled');
    });

    await expect(convertToBareWithWorktree(sourceDir, barePath, worktreesPath)).rejects.toThrow('nope');
    expect(renameMock).toHaveBeenCalledTimes(1);

    rmSync(workspaceDir, { recursive: true, force: true });
  });
});
