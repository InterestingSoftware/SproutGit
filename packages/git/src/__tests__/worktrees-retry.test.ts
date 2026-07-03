import { describe, it, expect, vi, beforeEach } from 'vitest';

const { gitForPathMock } = vi.hoisted(() => ({ gitForPathMock: vi.fn() }));
vi.mock('../client.js', () => ({ gitForPath: (...a: unknown[]) => gitForPathMock(...a) }));

import { listWorktrees } from '../worktrees.js';

const PORCELAIN_OUTPUT = [
  'worktree /repo/.sproutgit/root',
  'bare',
  '',
  'worktree /repo/.sproutgit/worktrees/bugfix/login-crash',
  'HEAD 1af2bdfdb179389cb4704cf9939f3deac1788778',
  'branch refs/heads/bugfix/login-crash',
  '',
].join('\n');

describe('listWorktrees retry', () => {
  const rawMock = vi.fn();

  beforeEach(() => {
    rawMock.mockReset();
    gitForPathMock.mockReset();
    gitForPathMock.mockReturnValue({ raw: rawMock });
  });

  it('retries once after a transient `git worktree list` failure and succeeds', async () => {
    rawMock
      .mockRejectedValueOnce(new Error(
        "fatal: failed to read 'worktrees/login-crash/locked': No such file or directory"
      ))
      .mockResolvedValueOnce(PORCELAIN_OUTPUT);

    const result = await listWorktrees('/repo/.sproutgit/root');

    expect(rawMock).toHaveBeenCalledTimes(2);
    expect(result.worktrees).toHaveLength(1);
    expect(result.worktrees[0]?.branch).toBe('bugfix/login-crash');
  });

  it('propagates the error when the transient message happens twice in a row', async () => {
    rawMock.mockRejectedValue(new Error(
      "fatal: failed to read 'worktrees/login-crash/locked': No such file or directory"
    ));

    await expect(listWorktrees('/repo/.sproutgit/root')).rejects.toThrow(/failed to read/);
    expect(rawMock).toHaveBeenCalledTimes(2);
  });

  it('does not retry an unrelated failure — propagates immediately', async () => {
    rawMock.mockRejectedValue(new Error('fatal: not a git repository'));

    await expect(listWorktrees('/repo/.sproutgit/root')).rejects.toThrow('fatal: not a git repository');
    expect(rawMock).toHaveBeenCalledTimes(1);
  });

  it('does not retry when the first call already succeeds', async () => {
    rawMock.mockResolvedValueOnce(PORCELAIN_OUTPUT);

    await listWorktrees('/repo/.sproutgit/root');

    expect(rawMock).toHaveBeenCalledTimes(1);
  });
});
