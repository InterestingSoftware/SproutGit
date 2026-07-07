import { describe, it, expect, vi, beforeEach } from 'vitest';
import { join } from 'node:path';
import { IPC } from '@sproutgit/types';

const { handleMock } = vi.hoisted(() => ({ handleMock: vi.fn() }));
vi.mock('electron', () => ({
  ipcMain: { handle: handleMock },
  app: { addRecentDocument: vi.fn() },
}));
vi.mock('../../telemetry.js', () => ({ log: { error: vi.fn(), info: vi.fn(), warn: vi.fn() } }));
vi.mock('../watcher.js', () => ({ stopWatchingPath: vi.fn() }));
vi.mock('../../mcp-bridge.js', () => ({ stopMcpServer: vi.fn().mockResolvedValue(undefined) }));

const { waitForIdleRepoMock, listWorktreesMock } = vi.hoisted(() => ({
  waitForIdleRepoMock: vi.fn().mockResolvedValue(undefined),
  listWorktreesMock: vi.fn(),
}));
vi.mock('@sproutgit/git', () => ({
  waitForIdleRepo: (...a: unknown[]) => waitForIdleRepoMock(...a),
  listWorktrees: (...a: unknown[]) => listWorktreesMock(...a),
}));

vi.mock('@sproutgit/database', () => ({
  openConfigDb: vi.fn(),
  openWorkspaceDb: vi.fn(),
  eq: vi.fn(),
  notInArray: vi.fn(),
}));

import { registerWorkspaceHandlers } from '../workspace.js';

type Handler = (event: unknown, ...args: unknown[]) => Promise<void>;

function getCloseHandler(): Handler {
  handleMock.mockClear();
  // The handler body never touches configDb, so an empty stub is enough.
  registerWorkspaceHandlers({} as never);
  const call = handleMock.mock.calls.find(c => c[0] === IPC.WORKSPACE_CLOSE);
  if (!call) throw new Error('WORKSPACE_CLOSE handler was not registered');
  return call[1] as Handler;
}

describe('WORKSPACE_CLOSE', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    waitForIdleRepoMock.mockResolvedValue(undefined);
  });

  it('waits for idle on the bare root and on every worktree path, not just root', async () => {
    const workspacePath = join('/ws');
    const rootPath = join(workspacePath, '.sproutgit', 'root');
    const worktreeA = join(workspacePath, '.sproutgit', 'worktrees', 'feature-a');
    const worktreeB = join(workspacePath, '.sproutgit', 'worktrees', 'feature-b');
    listWorktreesMock.mockResolvedValue({
      repoPath: rootPath,
      worktrees: [
        { path: worktreeA, head: 'abc', branch: 'feature-a', detached: false, isExternal: false },
        { path: worktreeB, head: 'def', branch: 'feature-b', detached: false, isExternal: false },
      ],
    });

    const close = getCloseHandler();
    await close({}, workspacePath);

    expect(listWorktreesMock).toHaveBeenCalledWith(rootPath);
    const waitedPaths = waitForIdleRepoMock.mock.calls.map(call => call[0]);
    expect(waitedPaths).toEqual(expect.arrayContaining([rootPath, worktreeA, worktreeB]));
    expect(waitedPaths).toHaveLength(3);
  });

  it('still waits on root when a worktree has been deleted mid-session and listWorktrees no longer reports it', async () => {
    // Git itself is the source of truth here, not stale worktree_metadata DB
    // rows — a deleted worktree simply doesn't come back from listWorktrees.
    const workspacePath = join('/ws');
    const rootPath = join(workspacePath, '.sproutgit', 'root');
    listWorktreesMock.mockResolvedValue({ repoPath: rootPath, worktrees: [] });

    const close = getCloseHandler();
    await close({}, workspacePath);

    expect(waitForIdleRepoMock).toHaveBeenCalledTimes(1);
    expect(waitForIdleRepoMock).toHaveBeenCalledWith(rootPath);
  });

  it('falls back to waiting on root alone when enumerating worktrees fails', async () => {
    const workspacePath = join('/ws');
    const rootPath = join(workspacePath, '.sproutgit', 'root');
    listWorktreesMock.mockRejectedValue(new Error('boom'));

    const close = getCloseHandler();
    await expect(close({}, workspacePath)).resolves.toBeUndefined();

    expect(waitForIdleRepoMock).toHaveBeenCalledTimes(1);
    expect(waitForIdleRepoMock).toHaveBeenCalledWith(rootPath);
  });

  it('falls back to waiting on root alone when enumerating worktrees hangs past its own bound', async () => {
    // listWorktrees() issues a real git command with up to a 60s timeout of
    // its own — much longer than the ~5s this handler should ever block for.
    // A worktree list call that never settles must not stall close.
    vi.useFakeTimers();
    try {
      const workspacePath = join('/ws');
      const rootPath = join(workspacePath, '.sproutgit', 'root');
      listWorktreesMock.mockReturnValue(new Promise(() => {})); // never settles

      const close = getCloseHandler();
      const closePromise = close({}, workspacePath);

      await vi.advanceTimersByTimeAsync(5_000);
      await closePromise;

      expect(waitForIdleRepoMock).toHaveBeenCalledTimes(1);
      expect(waitForIdleRepoMock).toHaveBeenCalledWith(rootPath);
    } finally {
      vi.useRealTimers();
    }
  });
});
