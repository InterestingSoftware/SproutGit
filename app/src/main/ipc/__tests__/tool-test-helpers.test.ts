import { describe, it, expect } from 'vitest';
import { resolveCommandPath, truncate, splitCommand, spawnAndConfirmLaunch, okResult, errResult } from '../tool-test-helpers.js';

// These tests exercise the REAL implementations (no mocking) — resolveCommandPath
// shells out to `which`/`where`, and spawnAndConfirmLaunch actually spawns a
// child process. `node` (process.execPath) is used as the target binary
// throughout since it's guaranteed present and behaves identically across the
// macOS/Linux/Windows unit-test matrix, mirroring the e2e agent-workflow spec's
// convention of using `node -e` for cross-platform determinism.

describe('resolveCommandPath', () => {
  it('resolves a real binary on PATH to an absolute path', async () => {
    const resolved = await resolveCommandPath(process.platform === 'win32' ? 'node.exe' : 'node');
    expect(resolved).toBeTruthy();
    expect(resolved).not.toBe('node');
  });

  it('returns null for a command that does not exist on PATH', async () => {
    const resolved = await resolveCommandPath('sproutgit-definitely-not-a-real-binary-xyz');
    expect(resolved).toBeNull();
  });

  it('returns null for an empty/whitespace command', async () => {
    expect(await resolveCommandPath('')).toBeNull();
    expect(await resolveCommandPath('   ')).toBeNull();
  });
});

describe('truncate', () => {
  it('returns trimmed text unchanged when under the max length', () => {
    expect(truncate('  hello  ', 100)).toBe('hello');
  });

  it('truncates and appends a char-count suffix when over the max length', () => {
    const text = 'x'.repeat(500);
    const result = truncate(text, 50);
    expect(result.startsWith('x'.repeat(50))).toBe(true);
    expect(result).toContain('(truncated, 500 chars total)');
  });

  it('defaults to a 400-char max when not specified', () => {
    const text = 'y'.repeat(450);
    const result = truncate(text);
    expect(result).toContain('truncated, 450 chars total');
  });
});

describe('splitCommand', () => {
  it('returns empty bin/args for an empty string', () => {
    expect(splitCommand('')).toEqual({ bin: '', args: [] });
    expect(splitCommand('   ')).toEqual({ bin: '', args: [] });
  });

  it('splits a simple space-separated command', () => {
    expect(splitCommand('claude --resume foo')).toEqual({ bin: 'claude', args: ['--resume', 'foo'] });
  });

  it('splits a command with no args', () => {
    expect(splitCommand('code')).toEqual({ bin: 'code', args: [] });
  });

  it('handles a double-quoted binary path with trailing args', () => {
    expect(splitCommand('"C:\\Program Files\\App\\app.exe" --wait')).toEqual({
      bin: 'C:\\Program Files\\App\\app.exe',
      args: ['--wait'],
    });
  });

  it('handles a single-quoted binary path with no trailing args', () => {
    expect(splitCommand("'/usr/local/bin/my tool'")).toEqual({
      bin: '/usr/local/bin/my tool',
      args: [],
    });
  });

  it('collapses repeated internal whitespace between args', () => {
    expect(splitCommand('cmd   a    b')).toEqual({ bin: 'cmd', args: ['a', 'b'] });
  });
});

describe('spawnAndConfirmLaunch', () => {
  it('resolves ok:true with stdout captured for a process that exits 0', async () => {
    const result = await spawnAndConfirmLaunch({
      bin: process.execPath,
      args: ['-e', "process.stdout.write('hello-from-child'); process.exit(0);"],
    });
    expect(result.ok).toBe(true);
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain('hello-from-child');
    expect(result.pid).toBeGreaterThan(0);
  });

  it('resolves ok:false with an error message for a non-zero exit code', async () => {
    const result = await spawnAndConfirmLaunch({
      bin: process.execPath,
      args: ['-e', "process.stderr.write('boom'); process.exit(3);"],
    });
    expect(result.ok).toBe(false);
    expect(result.exitCode).toBe(3);
    expect(result.stderr).toContain('boom');
    expect(result.error).toContain('3');
  });

  it('resolves ok:false with an error for a binary that does not exist', async () => {
    const result = await spawnAndConfirmLaunch({
      bin: 'sproutgit-definitely-not-a-real-binary-xyz',
      args: [],
      timeoutMs: 2000,
    });
    expect(result.ok).toBe(false);
    expect(result.error).toBeTruthy();
    expect(result.pid).toBeUndefined();
  });

  it('treats a long-lived process still alive past confirmAliveMs as a successful launch, then kills it', async () => {
    const result = await spawnAndConfirmLaunch({
      bin: process.execPath,
      args: ['-e', 'setInterval(() => {}, 1000);'],
      confirmAliveMs: 200,
      timeoutMs: 5000,
    });
    expect(result.ok).toBe(true);
    expect(result.pid).toBeGreaterThan(0);
    expect(result.exitCode).toBeUndefined();
  });

  it('resolves ok:false on a hard timeout for a process that never exits and is never confirmed alive first', async () => {
    // confirmAliveMs longer than timeoutMs means the hard timeout always wins.
    const result = await spawnAndConfirmLaunch({
      bin: process.execPath,
      args: ['-e', 'setInterval(() => {}, 1000);'],
      confirmAliveMs: 10_000,
      timeoutMs: 300,
    });
    expect(result.ok).toBe(false);
    expect(result.error).toContain('Timed out');
  });
});

describe('okResult / errResult', () => {
  it('builds a passing ToolTestResult', () => {
    expect(okResult('cmd --flag', 'it worked')).toEqual({
      ok: true,
      resolvedCommand: 'cmd --flag',
      detail: 'it worked',
    });
  });

  it('builds a failing ToolTestResult with an optional detail', () => {
    expect(errResult('cmd --flag', 'it broke')).toEqual({
      ok: false,
      resolvedCommand: 'cmd --flag',
      detail: '',
      error: 'it broke',
    });
    expect(errResult('cmd --flag', 'it broke', 'stderr here')).toEqual({
      ok: false,
      resolvedCommand: 'cmd --flag',
      detail: 'stderr here',
      error: 'it broke',
    });
  });
});
