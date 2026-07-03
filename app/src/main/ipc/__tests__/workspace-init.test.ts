import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, mkdirSync, rmSync, existsSync, realpathSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { IPC } from '@sproutgit/types';
import type { WorkspaceStatus } from '@sproutgit/types';

const { handleMock } = vi.hoisted(() => ({ handleMock: vi.fn() }));
vi.mock('electron', () => ({
  ipcMain: { handle: handleMock },
  BrowserWindow: { fromWebContents: vi.fn(() => null) },
}));
vi.mock('../../telemetry.js', () => ({ log: { error: vi.fn(), info: vi.fn(), warn: vi.fn() } }));

const { convertToBareWithWorktreeMock, initBareRepoMock, cloneBareRepoMock } = vi.hoisted(() => ({
  convertToBareWithWorktreeMock: vi.fn(),
  initBareRepoMock: vi.fn(),
  cloneBareRepoMock: vi.fn(),
}));
vi.mock('@sproutgit/git', () => ({
  convertToBareWithWorktree: (...a: unknown[]) => convertToBareWithWorktreeMock(...a),
  initBareRepo: (...a: unknown[]) => initBareRepoMock(...a),
  cloneBareRepo: (...a: unknown[]) => cloneBareRepoMock(...a),
}));

const { openWorkspaceDbMock } = vi.hoisted(() => ({ openWorkspaceDbMock: vi.fn() }));
vi.mock('@sproutgit/database', () => ({
  openWorkspaceDb: (...a: unknown[]) => openWorkspaceDbMock(...a),
}));

import { registerWorkspaceInitHandlers } from '../workspace-init.js';

type Handler = (event: unknown, ...args: unknown[]) => Promise<WorkspaceStatus>;

function getInspectHandler(): Handler {
  handleMock.mockClear();
  registerWorkspaceInitHandlers();
  const call = handleMock.mock.calls.find(c => c[0] === IPC.WORKSPACE_INSPECT);
  if (!call) throw new Error('WORKSPACE_INSPECT handler was not registered');
  return call[1] as Handler;
}

function tempWorkspace(prefix: string): string {
  return realpathSync.native(mkdtempSync(join(tmpdir(), prefix)));
}

describe('inspectWorkspace / migrateLegacyLayoutIfNeeded routing', () => {
  let workspacePath: string;

  beforeEach(() => {
    vi.clearAllMocks();
    openWorkspaceDbMock.mockReturnValue({ close: vi.fn() });
    workspacePath = tempWorkspace('sg-inspect-');
  });

  afterEach(() => {
    rmSync(workspacePath, { recursive: true, force: true });
  });

  it('is a no-op when .sproutgit/root already exists (already on the bare layout)', async () => {
    mkdirSync(join(workspacePath, '.sproutgit', 'root'), { recursive: true });
    mkdirSync(join(workspacePath, '.sproutgit', 'worktrees'), { recursive: true });

    const inspect = getInspectHandler();
    const status = await inspect({}, workspacePath);

    expect(convertToBareWithWorktreeMock).not.toHaveBeenCalled();
    expect(status.rootExists).toBe(true);
    expect(status.gitRepoPath).toBe(join(workspacePath, '.sproutgit', 'root'));
  });

  it('converts a legacy Rust layout (workspacePath/root/.git) on first inspect', async () => {
    const legacyRoot = join(workspacePath, 'root');
    mkdirSync(join(legacyRoot, '.git'), { recursive: true });
    convertToBareWithWorktreeMock.mockImplementation(async (_source: string, barePath: string) => {
      mkdirSync(barePath, { recursive: true });
      return { branch: 'main', worktreePath: join(workspacePath, '.sproutgit', 'worktrees', 'main') };
    });

    const inspect = getInspectHandler();
    const status = await inspect({}, workspacePath);

    expect(convertToBareWithWorktreeMock).toHaveBeenCalledTimes(1);
    const [source, bare, worktrees] = convertToBareWithWorktreeMock.mock.calls[0]!;
    expect(source).toBe(legacyRoot);
    expect(bare).toBe(join(workspacePath, '.sproutgit', 'root'));
    expect(worktrees).toBe(join(workspacePath, '.sproutgit', 'worktrees'));
    expect(existsSync(worktrees)).toBe(true); // pre-created before conversion, per the plan
    expect(status.gitRepoPath).toBe(bare);
    expect(status.rootExists).toBe(true);
  });

  it('converts a pre-existing imported-in-place layout (workspacePath/.git) on first inspect', async () => {
    mkdirSync(join(workspacePath, '.git'), { recursive: true });
    convertToBareWithWorktreeMock.mockImplementation(async (_source: string, barePath: string) => {
      mkdirSync(barePath, { recursive: true });
      return { branch: 'master', worktreePath: join(workspacePath, '.sproutgit', 'worktrees', 'master') };
    });

    const inspect = getInspectHandler();
    const status = await inspect({}, workspacePath);

    expect(convertToBareWithWorktreeMock).toHaveBeenCalledTimes(1);
    const [source] = convertToBareWithWorktreeMock.mock.calls[0]!;
    expect(source).toBe(workspacePath);
    expect(status.gitRepoPath).toBe(join(workspacePath, '.sproutgit', 'root'));
  });

  it('does not attempt conversion when no recognizable git repo exists, and returns an empty gitRepoPath', async () => {
    const inspect = getInspectHandler();
    const status = await inspect({}, workspacePath);

    expect(convertToBareWithWorktreeMock).not.toHaveBeenCalled();
    expect(status.gitRepoPath).toBe('');
    expect(status.rootExists).toBe(false);
  });

  it('propagates a conversion error (e.g. dirty working tree) instead of swallowing it', async () => {
    mkdirSync(join(workspacePath, '.git'), { recursive: true });
    convertToBareWithWorktreeMock.mockRejectedValue(new Error('Cannot convert: it has uncommitted changes.'));

    const inspect = getInspectHandler();
    await expect(inspect({}, workspacePath)).rejects.toThrow(/uncommitted changes/);
    // Nothing should have been created on a failed conversion.
    expect(existsSync(join(workspacePath, '.sproutgit', 'root'))).toBe(false);
  });
});
