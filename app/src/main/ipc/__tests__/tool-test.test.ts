import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { CommitMessageGeneratorSettings, ToolTestResult } from '@sproutgit/types';

const { handleMock } = vi.hoisted(() => ({ handleMock: vi.fn() }));
vi.mock('electron', () => ({ ipcMain: { handle: handleMock } }));
vi.mock('../../telemetry.js', () => ({ log: { error: vi.fn(), info: vi.fn(), warn: vi.fn() } }));

import { IPC } from '@sproutgit/types';
import { registerToolTestHandlers } from '../tool-test.js';

// These tests deliberately do NOT mock node:child_process or tool-test-helpers
// — the whole point of the "Test" button is that it runs a *real* scenario
// (a real scratch file / real git repo / real spawned process), so the most
// meaningful coverage here is exercising that real behavior end-to-end, using
// `node -e "<script>"` as the "configured tool" since it's guaranteed present
// and deterministic across the macOS/Linux/Windows unit-test matrix.

type Handler = (event: unknown, ...args: unknown[]) => Promise<ToolTestResult>;

function getHandler(channel: string): Handler {
  handleMock.mockClear();
  registerToolTestHandlers();
  const call = handleMock.mock.calls.find(c => c[0] === channel);
  if (!call) throw new Error(`${channel} handler was not registered`);
  return call[1] as Handler;
}

const NODE = process.execPath;

describe('TOOLTEST_EDITOR', () => {
  beforeEach(() => vi.clearAllMocks());

  it('reports an error when no editor is configured', async () => {
    const handler = getHandler(IPC.TOOLTEST_EDITOR);
    const result = await handler({}, '');
    expect(result).toEqual({ ok: false, resolvedCommand: '', detail: '', error: 'No editor configured.' });
  });

  it('reports "command not found" for an unresolvable binary', async () => {
    const handler = getHandler(IPC.TOOLTEST_EDITOR);
    const result = await handler({}, 'sproutgit-definitely-not-a-real-editor-xyz');
    expect(result.ok).toBe(false);
    expect(result.error).toContain('Command not found on PATH');
  });

  it('launches a real editor command against a scratch file and reports success', async () => {
    const handler = getHandler(IPC.TOOLTEST_EDITOR);
    // `node -e process.exit(0)` behaves like a CLI editor that opens and
    // exits cleanly (e.g. `vim -f`) — the real spawnAndConfirmLaunch path
    // runs. The command is split on whitespace with no shell involved (see
    // splitCommand), so the script must not contain spaces or quotes.
    const result = await handler({}, `${NODE} -e process.exit(0)`);
    expect(result.ok).toBe(true);
    expect(result.resolvedCommand).toContain('sproutgit-editor-test.txt');
    expect(result.detail).toContain('against');
  });

  it('reports failure when the editor process exits non-zero', async () => {
    const handler = getHandler(IPC.TOOLTEST_EDITOR);
    const result = await handler({}, `${NODE} -e process.exit(2)`);
    expect(result.ok).toBe(false);
    expect(result.error).toContain('2');
  });
});

describe('TOOLTEST_DIFF_TOOL', () => {
  beforeEach(() => vi.clearAllMocks());

  it('reports an error when no diff tool is configured', async () => {
    const handler = getHandler(IPC.TOOLTEST_DIFF_TOOL);
    const result = await handler({}, '');
    expect(result).toEqual({ ok: false, resolvedCommand: '', detail: '', error: 'No diff tool configured.' });
  });

  it('substitutes $LOCAL/$REMOTE and launches successfully', async () => {
    const handler = getHandler(IPC.TOOLTEST_DIFF_TOOL);
    // Script asserts both scratch files actually exist at the substituted
    // paths. No spaces/quotes allowed — the configured command string is
    // split on whitespace with no shell involved (see splitCommand).
    const script = "process.exit(require('fs').existsSync(process.argv[1])&&require('fs').existsSync(process.argv[2])?0:1)";
    const result = await handler({}, `${NODE} -e ${script} $LOCAL $REMOTE`);
    expect(result.ok).toBe(true);
    expect(result.resolvedCommand).toContain('local.txt');
    expect(result.resolvedCommand).toContain('remote.txt');
  });

  it('defaults to $LOCAL $REMOTE args when the configured command has no args', async () => {
    const handler = getHandler(IPC.TOOLTEST_DIFF_TOOL);
    // A bare command with no configured args (splitCommand returns args: [])
    // makes substituteDiffMergeVars fall back to ['$LOCAL', '$REMOTE'] — proven
    // here via the resolvedCommand, independent of whether `node <file> <file>`
    // (which tries to execute local.txt as a script and fails) "succeeds".
    const result = await handler({}, NODE);
    expect(result.resolvedCommand).toContain('local.txt');
    expect(result.resolvedCommand.endsWith('remote.txt')).toBe(true);
  });

  it('reports failure when the diff tool exits non-zero', async () => {
    const handler = getHandler(IPC.TOOLTEST_DIFF_TOOL);
    const result = await handler({}, `${NODE} -e process.exit(1) $LOCAL $REMOTE`);
    expect(result.ok).toBe(false);
  });
});

describe('TOOLTEST_MERGE_TOOL', () => {
  beforeEach(() => vi.clearAllMocks());

  it('reports an error when no merge tool is configured', async () => {
    const handler = getHandler(IPC.TOOLTEST_MERGE_TOOL);
    const result = await handler({}, '');
    expect(result).toEqual({ ok: false, resolvedCommand: '', detail: '', error: 'No merge tool configured.' });
  });

  it('substitutes $MERGED (and $LOCAL/$REMOTE/$BASE) and launches successfully', async () => {
    const handler = getHandler(IPC.TOOLTEST_MERGE_TOOL);
    const script = "process.exit(require('fs').readFileSync(process.argv[1],'utf8').includes('<<<<<<<')?0:1)";
    const result = await handler({}, `${NODE} -e ${script} $MERGED`);
    expect(result.ok).toBe(true);
    expect(result.resolvedCommand).toContain('merged.txt');
  });

  it('reports failure when the merge tool exits non-zero', async () => {
    const handler = getHandler(IPC.TOOLTEST_MERGE_TOOL);
    const result = await handler({}, `${NODE} -e process.exit(1) $MERGED`);
    expect(result.ok).toBe(false);
  });
});

describe('TOOLTEST_SHELL', () => {
  beforeEach(() => vi.clearAllMocks());

  it('reports an error when no shell is configured', async () => {
    const handler = getHandler(IPC.TOOLTEST_SHELL);
    const result = await handler({}, '');
    expect(result).toEqual({ ok: false, resolvedCommand: '', detail: '', error: 'No shell configured.' });
  });

  it('reports an error when the shell does not echo the expected output', async () => {
    const handler = getHandler(IPC.TOOLTEST_SHELL);
    // An unresolvable shell path falls back to itself, then execFile fails to spawn it.
    const result = await handler({}, 'sproutgit-definitely-not-a-real-shell-xyz');
    expect(result.ok).toBe(false);
    expect(result.error).toBeTruthy();
  });

  // Uses the real platform default shell to prove the real echo-and-check
  // path succeeds — this is the one scenario in this file that isn't spawned
  // via `node`, since the whole point is testing the *actual* configured shell.
  it('reports success for the platform default shell', async () => {
    const handler = getHandler(IPC.TOOLTEST_SHELL);
    const shellPath = process.platform === 'win32' ? 'cmd.exe' : (process.env.SHELL ?? '/bin/sh');
    const result = await handler({}, shellPath);
    expect(result.ok).toBe(true);
    expect(result.detail).toContain('Shell executed successfully');
  });
});

describe('TOOLTEST_COMMIT_MESSAGE_GENERATOR', () => {
  beforeEach(() => vi.clearAllMocks());

  it('reports an error when no command is configured', async () => {
    const handler = getHandler(IPC.TOOLTEST_COMMIT_MESSAGE_GENERATOR);
    const settings: CommitMessageGeneratorSettings = { presetId: 'custom', command: '', args: [] };
    const result = await handler({}, settings);
    expect(result).toEqual({ ok: false, resolvedCommand: '', detail: '', error: 'No commit message generator configured.' });
  });

  it('reports "command not found" for an unresolvable generator command', async () => {
    const handler = getHandler(IPC.TOOLTEST_COMMIT_MESSAGE_GENERATOR);
    const settings: CommitMessageGeneratorSettings = { presetId: 'custom', command: 'sproutgit-definitely-not-a-real-generator-xyz', args: [] };
    const result = await handler({}, settings);
    expect(result.ok).toBe(false);
    expect(result.error).toContain('Command not found on PATH');
  });

  it('builds a real scratch git repo, feeds the staged diff on stdin, and reports the generated message', async () => {
    const handler = getHandler(IPC.TOOLTEST_COMMIT_MESSAGE_GENERATOR);
    // Script reads stdin (the real staged diff) and echoes a fixed message —
    // proving the diff was actually piped in, not just that the process ran.
    const script = "let d='';process.stdin.on('data',c=>d+=c);process.stdin.on('end',()=>{process.stdout.write(d.includes('README') ? 'feat: update readme' : 'no diff seen');process.exit(0);});";
    const settings: CommitMessageGeneratorSettings = { presetId: 'custom', command: NODE, args: ['-e', script] };
    const result = await handler({}, settings);
    expect(result.ok).toBe(true);
    expect(result.detail).toContain('feat: update readme');
  });

  it('substitutes $SPROUTGIT_RECENT_COMMITS in args with the scratch repo\'s real commit subject', async () => {
    const handler = getHandler(IPC.TOOLTEST_COMMIT_MESSAGE_GENERATOR);
    // Extra positional args (beyond the -e script) start at process.argv[1].
    const script = "process.stdout.write('recent:' + process.argv[1]); process.exit(0);";
    const settings: CommitMessageGeneratorSettings = {
      presetId: 'custom',
      command: NODE,
      args: ['-e', script, '$SPROUTGIT_RECENT_COMMITS'],
    };
    const result = await handler({}, settings);
    expect(result.ok).toBe(true);
    expect(result.detail).toContain('recent:initial commit');
  });

  it('reports failure when the generator exits non-zero', async () => {
    const handler = getHandler(IPC.TOOLTEST_COMMIT_MESSAGE_GENERATOR);
    const settings: CommitMessageGeneratorSettings = {
      presetId: 'custom',
      command: NODE,
      args: ['-e', "process.stderr.write('auth error');process.exit(1)"],
    };
    const result = await handler({}, settings);
    expect(result.ok).toBe(false);
    expect(result.error).toContain('auth error');
  });

  it('reports failure when the generator produces no output', async () => {
    const handler = getHandler(IPC.TOOLTEST_COMMIT_MESSAGE_GENERATOR);
    const settings: CommitMessageGeneratorSettings = {
      presetId: 'custom',
      command: NODE,
      args: ['-e', 'process.exit(0)'],
    };
    const result = await handler({}, settings);
    expect(result.ok).toBe(false);
    expect(result.error).toContain('no output');
  });
});
