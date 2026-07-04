import { tmpdir } from 'node:os';
import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { ToolTestResult } from '@sproutgit/types';

const { handleMock } = vi.hoisted(() => ({ handleMock: vi.fn() }));
vi.mock('electron', () => ({ ipcMain: { handle: handleMock } }));
vi.mock('../../telemetry.js', () => ({ log: { error: vi.fn(), info: vi.fn(), warn: vi.fn() } }));
// AGENT_LAUNCH needs a real PTY manager, but AGENT_TEST (the only handler
// these tests exercise) doesn't touch it -- mocked out so this test doesn't
// depend on node-pty's native binary being built for the current platform.
vi.mock('../terminal.js', () => ({ manager: { spawn: vi.fn() }, sessionWindows: new Map() }));

import { IPC } from '@sproutgit/types';
import { openConfigDb, saveAgentConfig, type ConfigDb } from '@sproutgit/database';
import { registerAgentHandlers, commandSupportsIntegratedMode } from '../agents.js';

// These tests deliberately do NOT mock node:child_process or
// tool-test-helpers -- same rationale as tool-test.test.ts: the whole point
// of the Test button is that it runs a *real* scenario. There's no real
// Claude Code CLI available in CI to exercise the actual `-p` spawn end to
// end, and faking one reliably across macOS/Linux/Windows (execFile on an
// absolute path needs a real executable, not just a same-named shell
// script) isn't practical here -- so the Claude-Code-recognized path is
// proven at the commandSupportsIntegratedMode level instead (the exact
// function AGENT_TEST gates on), paired with an end-to-end test proving an
// *unrecognized* command correctly skips the live prompt spawn instead of
// hanging on a bare positional argument until the timeout.

type Handler = (event: unknown) => Promise<ToolTestResult>;

function getHandler(configDb: ConfigDb): Handler {
  handleMock.mockClear();
  registerAgentHandlers(configDb, () => null);
  const call = handleMock.mock.calls.find(c => c[0] === IPC.AGENT_TEST);
  if (!call) throw new Error(`${IPC.AGENT_TEST} handler was not registered`);
  return call[1] as Handler;
}

describe('commandSupportsIntegratedMode', () => {
  it('recognizes claude and claude-code, case- and path-insensitively', () => {
    expect(commandSupportsIntegratedMode('claude')).toBe(true);
    expect(commandSupportsIntegratedMode('CLAUDE')).toBe(true);
    expect(commandSupportsIntegratedMode('claude-code')).toBe(true);
    expect(commandSupportsIntegratedMode('/usr/local/bin/claude')).toBe(true);
    // A path containing spaces needs quoting for splitCommand to treat it as
    // one token (see splitCommand's own doc comment) -- same as any other
    // configured tool command in this app. Note the basename check doesn't
    // strip a .exe extension, matching how a Windows user would actually
    // configure this (without the extension, relying on PATHEXT/`where`).
    expect(commandSupportsIntegratedMode('"C:\\Program Files\\claude\\claude"')).toBe(true);
  });

  it('does not recognize other CLIs', () => {
    expect(commandSupportsIntegratedMode('kiro')).toBe(false);
    expect(commandSupportsIntegratedMode('codex')).toBe(false);
    expect(commandSupportsIntegratedMode('gemini')).toBe(false);
    expect(commandSupportsIntegratedMode(process.execPath)).toBe(false);
    expect(commandSupportsIntegratedMode('')).toBe(false);
  });
});

describe('AGENT_TEST', () => {
  let tmpDir: string;
  let configDb: ConfigDb;

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), 'sg-test-agent-'));
    configDb = openConfigDb(join(tmpDir, 'config.db'));
  });

  afterEach(() => {
    configDb.close();
    rmSync(tmpDir, { recursive: true, force: true });
  });

  it('reports an error when no agent is configured', async () => {
    saveAgentConfig(configDb, { command: '', args: [], mode: 'terminal' });
    const handler = getHandler(configDb);
    const result = await handler({});
    expect(result).toEqual({ ok: false, resolvedCommand: '', detail: '', error: 'No agent command configured.' });
  });

  it('reports "command not found" for an unresolvable agent command', async () => {
    saveAgentConfig(configDb, { command: 'sproutgit-definitely-not-a-real-agent-xyz', args: [], mode: 'terminal' });
    const handler = getHandler(configDb);
    const result = await handler({});
    expect(result.ok).toBe(false);
    expect(result.error).toContain('Command not found on PATH');
  });

  it('does not run a live prompt test for a command that is not recognized as Claude Code', async () => {
    // process.execPath resolves to a real, guaranteed-present binary, but its
    // basename ("node"/"node.exe") is not recognized as Claude Code -- this
    // is exactly the case that used to hang until AGENT_TEST's 15s timeout
    // (a bare positional prompt argument, which most CLIs don't treat as
    // non-interactive input).
    saveAgentConfig(configDb, { command: process.execPath, args: [], mode: 'terminal' });
    const handler = getHandler(configDb);
    const result = await handler({});
    expect(result.ok).toBe(true);
    expect(result.resolvedCommand).not.toContain('-p');
    expect(result.detail).toContain("non-interactive prompt flag isn't known");
  });
});
