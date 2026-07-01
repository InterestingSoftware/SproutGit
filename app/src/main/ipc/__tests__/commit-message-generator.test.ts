import { describe, it, expect, vi, beforeEach } from 'vitest';

const { handleMock, getStagedDiffMock, getRecentCommitSubjectsMock, execFileMock } = vi.hoisted(() => ({
  handleMock: vi.fn(),
  getStagedDiffMock: vi.fn(),
  getRecentCommitSubjectsMock: vi.fn(),
  execFileMock: vi.fn(),
}));

vi.mock('electron', () => ({ ipcMain: { handle: handleMock } }));
vi.mock('../../telemetry.js', () => ({ log: { error: vi.fn(), info: vi.fn(), warn: vi.fn() } }));
vi.mock('@sproutgit/git', () => ({
  getStagedDiff: (...args: unknown[]) => getStagedDiffMock(...args),
  getRecentCommitSubjects: (...args: unknown[]) => getRecentCommitSubjectsMock(...args),
}));
vi.mock('node:child_process', () => ({ execFile: (...args: unknown[]) => execFileMock(...args) }));

import { registerCommitMessageGeneratorHandlers } from '../commit-message-generator.js';

type Handler = (event: unknown, args: {
  workspacePath: string;
  worktreePath: string;
  settings: { presetId: string; command: string; args: string[] };
}) => Promise<unknown>;

function getRegisteredHandler(): Handler {
  registerCommitMessageGeneratorHandlers();
  const call = handleMock.mock.calls.find(c => c[0] === 'commitmsg:generate');
  if (!call) throw new Error('commitmsg:generate handler was not registered');
  return call[1] as Handler;
}

const baseArgs = {
  workspacePath: '/ws',
  worktreePath: '/ws/.sproutgit/worktrees/main',
  settings: { presetId: 'claude-code', command: 'claude', args: ['-p', 'write a commit message'] },
};

describe('commitmsg:generate', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('refuses to run when no command is configured', async () => {
    const handler = getRegisteredHandler();
    const result = await handler({}, { ...baseArgs, settings: { presetId: 'custom', command: '', args: [] } });
    expect(result).toEqual({ error: 'No commit message generator configured. Pick a preset or enter a command in Settings.' });
    expect(getStagedDiffMock).not.toHaveBeenCalled();
  });

  it('refuses to run when the staged diff is empty', async () => {
    getStagedDiffMock.mockResolvedValue('   \n');
    const handler = getRegisteredHandler();
    const result = await handler({}, baseArgs);
    expect(result).toEqual({ error: 'No staged changes to generate a message for.' });
    expect(execFileMock).not.toHaveBeenCalled();
  });

  it('writes the staged diff to stdin and returns the trimmed stdout as the message', async () => {
    getStagedDiffMock.mockResolvedValue('diff --git a/foo b/foo\n+bar\n');
    getRecentCommitSubjectsMock.mockResolvedValue(['fix: bar', 'feat: foo']);
    const stdinWrite = vi.fn();
    const stdinEnd = vi.fn();
    execFileMock.mockImplementation((_cmd, _args, _opts, callback: (...cbArgs: unknown[]) => void) => {
      callback(null, '  feat: add bar\n', '');
      return { stdin: { write: stdinWrite, end: stdinEnd, on: vi.fn() } };
    });

    const handler = getRegisteredHandler();
    const result = await handler({}, baseArgs);

    expect(result).toEqual({ message: 'feat: add bar' });
    expect(stdinWrite).toHaveBeenCalledWith('diff --git a/foo b/foo\n+bar\n');
    expect(stdinEnd).toHaveBeenCalled();

    const [command, args, options] = execFileMock.mock.calls[0]!;
    expect(command).toBe('claude');
    expect(args).toEqual(['-p', 'write a commit message']);
    expect(options.cwd).toBe(baseArgs.worktreePath);
    expect(options.env.SPROUTGIT_RECENT_COMMITS).toBe('fix: bar\nfeat: foo');
    expect(options.env.SPROUTGIT_WORKTREE).toBe(baseArgs.worktreePath);
  });

  it('substitutes $SPROUTGIT_* tokens in args before spawning', async () => {
    getStagedDiffMock.mockResolvedValue('some diff');
    getRecentCommitSubjectsMock.mockResolvedValue(['fix: bar']);
    execFileMock.mockImplementation((_cmd, _args, _opts, callback: (...cbArgs: unknown[]) => void) => {
      callback(null, 'chore: x', '');
      return { stdin: { write: vi.fn(), end: vi.fn(), on: vi.fn() } };
    });

    const handler = getRegisteredHandler();
    await handler({}, {
      ...baseArgs,
      settings: { presetId: 'claude-code', command: 'claude', args: ['-p', 'style ref: $SPROUTGIT_RECENT_COMMITS'] },
    });

    const [, args] = execFileMock.mock.calls[0]!;
    expect(args).toEqual(['-p', 'style ref: fix: bar']);
  });

  it('reports a timeout as a distinct error', async () => {
    getStagedDiffMock.mockResolvedValue('some diff');
    getRecentCommitSubjectsMock.mockResolvedValue([]);
    execFileMock.mockImplementation((_cmd, _args, _opts, callback: (...cbArgs: unknown[]) => void) => {
      const err = Object.assign(new Error('killed'), { killed: true });
      callback(err, '', '');
      return { stdin: { write: vi.fn(), end: vi.fn(), on: vi.fn() } };
    });

    const handler = getRegisteredHandler();
    const result = await handler({}, baseArgs);
    expect(result).toEqual({ error: 'Generator timed out after 90s.' });
  });

  it('surfaces stderr when the command exits non-zero', async () => {
    getStagedDiffMock.mockResolvedValue('some diff');
    getRecentCommitSubjectsMock.mockResolvedValue([]);
    execFileMock.mockImplementation((_cmd, _args, _opts, callback: (...cbArgs: unknown[]) => void) => {
      callback(new Error('exit 1'), '', 'auth error: not logged in\n');
      return { stdin: { write: vi.fn(), end: vi.fn(), on: vi.fn() } };
    });

    const handler = getRegisteredHandler();
    const result = await handler({}, baseArgs);
    expect(result).toEqual({ error: 'auth error: not logged in' });
  });

  it('treats empty stdout as a failure', async () => {
    getStagedDiffMock.mockResolvedValue('some diff');
    getRecentCommitSubjectsMock.mockResolvedValue([]);
    execFileMock.mockImplementation((_cmd, _args, _opts, callback: (...cbArgs: unknown[]) => void) => {
      callback(null, '   ', '');
      return { stdin: { write: vi.fn(), end: vi.fn(), on: vi.fn() } };
    });

    const handler = getRegisteredHandler();
    const result = await handler({}, baseArgs);
    expect(result).toEqual({ error: 'Generator produced no output.' });
  });
});
