import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, realpathSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { IPC } from '@sproutgit/types';

const { handleMock } = vi.hoisted(() => ({ handleMock: vi.fn() }));
vi.mock('electron', () => ({ ipcMain: { handle: handleMock } }));
vi.mock('../../telemetry.js', () => ({ log: { error: vi.fn(), info: vi.fn(), warn: vi.fn() } }));

// isBareRepoPath is left as the REAL implementation — the guard's behavior
// depends on it, so these tests exercise it against real directories rather
// than mocking it away.
const { getGitInfoMock } = vi.hoisted(() => ({ getGitInfoMock: vi.fn() }));
vi.mock('@sproutgit/git', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@sproutgit/git')>();
  return { ...actual, getGitInfo: (...args: unknown[]) => getGitInfoMock(...args) };
});

const {
  listWorktreesMock, createManagedWorktreeMock, deleteManagedWorktreeMock,
} = vi.hoisted(() => ({
  listWorktreesMock: vi.fn(),
  createManagedWorktreeMock: vi.fn(),
  deleteManagedWorktreeMock: vi.fn(),
}));
vi.mock('@sproutgit/git/worktrees', () => ({
  listWorktrees: (...a: unknown[]) => listWorktreesMock(...a),
  createManagedWorktree: (...a: unknown[]) => createManagedWorktreeMock(...a),
  deleteManagedWorktree: (...a: unknown[]) => deleteManagedWorktreeMock(...a),
}));

const { getCommitGraphMock, countCommitsMock, listRefsMock } = vi.hoisted(() => ({
  getCommitGraphMock: vi.fn(),
  countCommitsMock: vi.fn(),
  listRefsMock: vi.fn(),
}));
vi.mock('@sproutgit/git/commits', () => ({
  getCommitGraph: (...a: unknown[]) => getCommitGraphMock(...a),
  countCommits: (...a: unknown[]) => countCommitsMock(...a),
  listRefs: (...a: unknown[]) => listRefsMock(...a),
}));

const {
  getWorktreeStatusMock, stageFilesMock, unstageFilesMock,
  createCommitMock, checkoutWorktreeMock, resetWorktreeBranchMock,
} = vi.hoisted(() => ({
  getWorktreeStatusMock: vi.fn(),
  stageFilesMock: vi.fn(),
  unstageFilesMock: vi.fn(),
  createCommitMock: vi.fn(),
  checkoutWorktreeMock: vi.fn(),
  resetWorktreeBranchMock: vi.fn(),
}));
vi.mock('@sproutgit/git/staging', () => ({
  getWorktreeStatus: (...a: unknown[]) => getWorktreeStatusMock(...a),
  stageFiles: (...a: unknown[]) => stageFilesMock(...a),
  unstageFiles: (...a: unknown[]) => unstageFilesMock(...a),
  createCommit: (...a: unknown[]) => createCommitMock(...a),
  checkoutWorktree: (...a: unknown[]) => checkoutWorktreeMock(...a),
  resetWorktreeBranch: (...a: unknown[]) => resetWorktreeBranchMock(...a),
}));

const {
  fetchWorktreeMock, pullWorktreeMock, pushWorktreeBranchMock, getWorktreePushStatusMock,
} = vi.hoisted(() => ({
  fetchWorktreeMock: vi.fn(),
  pullWorktreeMock: vi.fn(),
  pushWorktreeBranchMock: vi.fn(),
  getWorktreePushStatusMock: vi.fn(),
}));
vi.mock('@sproutgit/git/remote', () => ({
  fetchWorktree: (...a: unknown[]) => fetchWorktreeMock(...a),
  pullWorktree: (...a: unknown[]) => pullWorktreeMock(...a),
  pushWorktreeBranch: (...a: unknown[]) => pushWorktreeBranchMock(...a),
  getWorktreePushStatus: (...a: unknown[]) => getWorktreePushStatusMock(...a),
}));

const { getDiffFilesMock, getDiffContentMock, getWorkingDiffMock } = vi.hoisted(() => ({
  getDiffFilesMock: vi.fn(),
  getDiffContentMock: vi.fn(),
  getWorkingDiffMock: vi.fn(),
}));
vi.mock('@sproutgit/git/diff', () => ({
  getDiffFiles: (...a: unknown[]) => getDiffFilesMock(...a),
  getDiffContent: (...a: unknown[]) => getDiffContentMock(...a),
  getWorkingDiff: (...a: unknown[]) => getWorkingDiffMock(...a),
}));

import { registerGitHandlers } from '../git.js';

type Handler = (event: unknown, ...args: unknown[]) => Promise<unknown>;

function getHandlers(): Map<string, Handler> {
  registerGitHandlers(() => null);
  const map = new Map<string, Handler>();
  for (const [channel, fn] of handleMock.mock.calls) map.set(channel as string, fn as Handler);
  return map;
}

function tempDir(prefix: string): string {
  return realpathSync.native(mkdtempSync(join(tmpdir(), prefix)));
}

/** A directory shaped like a bare repo: HEAD/objects/refs, no nested .git. */
function makeBareRepoDir(): string {
  const dir = tempDir('sg-guard-bare-');
  mkdirSync(join(dir, 'objects'));
  mkdirSync(join(dir, 'refs'));
  writeFileSync(join(dir, 'HEAD'), 'ref: refs/heads/main\n');
  return dir;
}

/** A directory shaped like an ordinary worktree: has a nested .git. */
function makeWorktreeDir(): string {
  const dir = tempDir('sg-guard-worktree-');
  mkdirSync(join(dir, '.git'));
  return dir;
}

describe('git IPC root guard', () => {
  let bareRepoPath: string;
  let worktreePath: string;

  beforeEach(() => {
    vi.clearAllMocks();
    handleMock.mockClear();
    bareRepoPath = makeBareRepoDir();
    worktreePath = makeWorktreeDir();
  });

  afterEach(() => {
    rmSync(bareRepoPath, { recursive: true, force: true });
    rmSync(worktreePath, { recursive: true, force: true });
  });

  it('rejects git:status against a bare repo path without calling the underlying git function', async () => {
    const handlers = getHandlers();
    await expect(handlers.get(IPC.GIT_STATUS)!({}, bareRepoPath))
      .rejects.toThrow(/Refusing to run a working-tree git operation/);
    expect(getWorktreeStatusMock).not.toHaveBeenCalled();
  });

  it('allows git:status against a real worktree path', async () => {
    getWorktreeStatusMock.mockResolvedValue({ worktreePath, files: [] });
    const handlers = getHandlers();
    const result = await handlers.get(IPC.GIT_STATUS)!({}, worktreePath);
    expect(result).toEqual({ worktreePath, files: [] });
    expect(getWorktreeStatusMock).toHaveBeenCalledWith(worktreePath);
  });

  it('rejects every guarded staging/remote/diff handler against a bare repo path', async () => {
    const handlers = getHandlers();

    await expect(handlers.get(IPC.GIT_STAGE)!({}, { worktreePath: bareRepoPath, paths: [] }))
      .rejects.toThrow(/Refusing/);
    await expect(handlers.get(IPC.GIT_UNSTAGE)!({}, { worktreePath: bareRepoPath, paths: [] }))
      .rejects.toThrow(/Refusing/);
    await expect(handlers.get(IPC.GIT_COMMIT)!({}, { worktreePath: bareRepoPath, message: 'x' }))
      .rejects.toThrow(/Refusing/);
    await expect(handlers.get(IPC.GIT_CHECKOUT)!({}, { worktreePath: bareRepoPath, targetRef: 'main' }))
      .rejects.toThrow(/Refusing/);
    await expect(handlers.get(IPC.GIT_RESET)!({}, { worktreePath: bareRepoPath, targetRef: 'main', mode: 'hard' }))
      .rejects.toThrow(/Refusing/);
    await expect(handlers.get(IPC.GIT_PULL)!({}, bareRepoPath))
      .rejects.toThrow(/Refusing/);
    await expect(handlers.get(IPC.GIT_PUSH)!({}, { worktreePath: bareRepoPath }))
      .rejects.toThrow(/Refusing/);
    await expect(handlers.get(IPC.GIT_PUSH_STATUS)!({}, bareRepoPath))
      .rejects.toThrow(/Refusing/);
    await expect(handlers.get(IPC.GIT_WORKING_DIFF)!({}, { worktreePath: bareRepoPath }))
      .rejects.toThrow(/Refusing/);

    expect(stageFilesMock).not.toHaveBeenCalled();
    expect(unstageFilesMock).not.toHaveBeenCalled();
    expect(createCommitMock).not.toHaveBeenCalled();
    expect(checkoutWorktreeMock).not.toHaveBeenCalled();
    expect(resetWorktreeBranchMock).not.toHaveBeenCalled();
    expect(pullWorktreeMock).not.toHaveBeenCalled();
    expect(pushWorktreeBranchMock).not.toHaveBeenCalled();
    expect(getWorktreePushStatusMock).not.toHaveBeenCalled();
    expect(getWorkingDiffMock).not.toHaveBeenCalled();
  });

  it('does not guard git:fetch — fetch is safe to run against a bare repo', async () => {
    fetchWorktreeMock.mockResolvedValue(undefined);
    const handlers = getHandlers();
    await handlers.get(IPC.GIT_FETCH)!({}, bareRepoPath);
    expect(fetchWorktreeMock).toHaveBeenCalledWith(bareRepoPath);
  });

  it('allows the guarded handlers to proceed against a real worktree path', async () => {
    pullWorktreeMock.mockResolvedValue(undefined);
    pushWorktreeBranchMock.mockResolvedValue(undefined);
    const handlers = getHandlers();

    await handlers.get(IPC.GIT_PULL)!({}, worktreePath);
    expect(pullWorktreeMock).toHaveBeenCalledWith(worktreePath);

    await handlers.get(IPC.GIT_PUSH)!({}, { worktreePath, remote: 'origin' });
    expect(pushWorktreeBranchMock).toHaveBeenCalledWith(worktreePath, 'origin');
  });
});
