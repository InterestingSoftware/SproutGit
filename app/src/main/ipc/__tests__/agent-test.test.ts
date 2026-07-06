import { tmpdir } from 'node:os';
import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { AgentTestInput, ToolTestResult } from '@sproutgit/types';

const { handleMock } = vi.hoisted(() => ({ handleMock: vi.fn() }));
vi.mock('electron', () => ({ ipcMain: { handle: handleMock } }));
vi.mock('../../telemetry.js', () => ({ log: { error: vi.fn(), info: vi.fn(), warn: vi.fn() } }));
// AGENT_LAUNCH needs a real PTY manager, but AGENT_TEST (the only handler
// these tests exercise) doesn't touch it -- mocked out so this test doesn't
// depend on node-pty's native binary being built for the current platform.
vi.mock('../terminal.js', () => ({ manager: { spawn: vi.fn() }, sessionWindows: new Map() }));

import { IPC } from '@sproutgit/types';
import { openConfigDb, type ConfigDb } from '@sproutgit/database';
import { registerAgentHandlers, commandSupportsIntegratedMode, getAcpLaunchSpec, getAcpLaunchSpecForAgent } from '../agents.js';

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
// hanging on a bare positional argument until the timeout. The ACP handshake
// path, however, *is* exercised end to end below, against the real minimal
// example agent shipped by @agentclientprotocol/sdk (no credentials needed).

type Handler = (input: AgentTestInput) => Promise<ToolTestResult>;

function getHandler(configDb: ConfigDb): Handler {
  handleMock.mockClear();
  registerAgentHandlers(configDb, '/tmp/sg-test-userdata');
  const call = handleMock.mock.calls.find(c => c[0] === IPC.AGENT_TEST);
  if (!call) throw new Error(`${IPC.AGENT_TEST} handler was not registered`);
  const rawHandler = call[1] as (event: unknown, input: AgentTestInput) => Promise<ToolTestResult>;
  return (input: AgentTestInput) => rawHandler({}, input);
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

  it('recognizes every ACP-capable preset CLI, case-insensitively', () => {
    expect(commandSupportsIntegratedMode('gemini')).toBe(true);
    expect(commandSupportsIntegratedMode('GEMINI')).toBe(true);
    expect(commandSupportsIntegratedMode('codex')).toBe(true);
    expect(commandSupportsIntegratedMode('kiro')).toBe(true);
    expect(commandSupportsIntegratedMode('kiro-cli')).toBe(true);
    expect(commandSupportsIntegratedMode('cursor-agent')).toBe(true);
  });

  it('does not recognize unknown commands', () => {
    expect(commandSupportsIntegratedMode(process.execPath)).toBe(false);
    expect(commandSupportsIntegratedMode('')).toBe(false);
  });
});

describe('getAcpLaunchSpec', () => {
  it('returns null for an unrecognized command', () => {
    expect(getAcpLaunchSpec(process.execPath, [])).toBeNull();
    expect(getAcpLaunchSpec('', [])).toBeNull();
  });

  it('spawns the separate claude-agent-acp adapter for Claude Code, ignoring configured args', () => {
    expect(getAcpLaunchSpec('claude', ['--dangerously-skip-permissions'])).toEqual({
      bin: 'claude-agent-acp',
      args: [],
      label: 'Claude Code',
      npmPackage: '@agentclientprotocol/claude-agent-acp',
      approxSizeMb: 220,
    });
  });

  it('spawns the separate codex-acp adapter for Codex CLI, ignoring configured args', () => {
    expect(getAcpLaunchSpec('codex', ['--model', 'o3'])).toEqual({
      bin: 'codex-acp',
      args: [],
      label: 'Codex CLI',
      npmPackage: '@agentclientprotocol/codex-acp',
      approxSizeMb: 245,
    });
  });

  it('appends --acp to the configured Gemini CLI command', () => {
    expect(getAcpLaunchSpec('gemini', ['--model', 'gemini-3-pro'])).toEqual({
      bin: 'gemini',
      args: ['--model', 'gemini-3-pro', '--acp'],
      label: 'Gemini CLI',
    });
  });

  it('appends the acp subcommand to the configured Kiro CLI command', () => {
    expect(getAcpLaunchSpec('kiro-cli', [])).toEqual({
      bin: 'kiro-cli',
      args: ['acp'],
      label: 'Kiro CLI',
    });
  });

  it('appends the acp subcommand to the configured Cursor CLI command', () => {
    expect(getAcpLaunchSpec('cursor-agent', [])).toEqual({
      bin: 'cursor-agent',
      args: ['acp'],
      label: 'Cursor CLI',
    });
  });
});

describe('getAcpLaunchSpecForAgent', () => {
  it('prefers the recognized preset invocation even if the roster entry itself is not flagged acp', () => {
    expect(getAcpLaunchSpecForAgent({ name: 'My Claude', command: 'claude', args: [], acp: false })).toEqual({
      bin: 'claude-agent-acp',
      args: [],
      label: 'Claude Code',
      npmPackage: '@agentclientprotocol/claude-agent-acp',
      approxSizeMb: 220,
    });
  });

  it('spawns an unrecognized command as configured when the user asserts acp: true', () => {
    expect(getAcpLaunchSpecForAgent({ name: 'My Internal Agent', command: 'my-internal-acp-cli', args: ['--flag'], acp: true })).toEqual({
      bin: 'my-internal-acp-cli',
      args: ['--flag'],
      label: 'My Internal Agent',
    });
  });

  it('returns null for an unrecognized command not flagged acp', () => {
    expect(getAcpLaunchSpecForAgent({ name: 'Plain CLI', command: 'my-plain-cli', args: [], acp: false })).toBeNull();
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
    const handler = getHandler(configDb);
    const result = await handler({ command: '', args: [], acp: false });
    expect(result).toEqual({ ok: false, resolvedCommand: '', detail: '', error: 'No agent command configured.' });
  });

  it('reports "command not found" for an unresolvable agent command', async () => {
    const handler = getHandler(configDb);
    const result = await handler({ command: 'sproutgit-definitely-not-a-real-agent-xyz', args: [], acp: false });
    expect(result.ok).toBe(false);
    expect(result.error).toContain('Command not found on PATH');
  });

  it('does not run a live prompt test for a command that is not recognized as Claude Code', async () => {
    // process.execPath resolves to a real, guaranteed-present binary, but its
    // basename ("node"/"node.exe") is not recognized as Claude Code -- this
    // is exactly the case that used to hang until AGENT_TEST's 15s timeout
    // (a bare positional prompt argument, which most CLIs don't treat as
    // non-interactive input).
    const handler = getHandler(configDb);
    const result = await handler({ command: process.execPath, args: [], acp: false });
    expect(result.ok).toBe(true);
    expect(result.resolvedCommand).not.toContain('-p');
    expect(result.detail).toContain("non-interactive prompt flag isn't known");
  });

  it('reports an error for an acp-flagged agent whose binary cannot be resolved', async () => {
    const handler = getHandler(configDb);
    const result = await handler({ name: 'Ghost Agent', command: 'sproutgit-definitely-not-a-real-acp-agent-xyz', args: [], acp: true });
    expect(result.ok).toBe(false);
    expect(result.error).toContain('Could not find');
  });

  it('performs a real ACP initialize handshake for an ad-hoc acp-flagged agent and reports its capabilities', async () => {
    const EXAMPLE_AGENT_PATH = join(process.cwd(), 'node_modules/@agentclientprotocol/sdk/dist/examples/agent.js');
    const handler = getHandler(configDb);
    const result = await handler({ name: 'Example Agent', command: process.execPath, args: [EXAMPLE_AGENT_PATH], acp: true });

    expect(result.ok).toBe(true);
    expect(result.resolvedCommand).toContain(EXAMPLE_AGENT_PATH);
    // The example agent's initialize() response has no agentInfo -- falls
    // back to the configured agent's own name for display.
    expect(result.acp?.name).toBe('Example Agent');
    expect(result.acp?.capabilities).not.toContain('loadSession'); // the example agent reports loadSession: false
  }, 15_000);

  it('reports a clear error for an acp-flagged agent whose process exits immediately', async () => {
    const handler = getHandler(configDb);
    const result = await handler({ name: 'Bad Agent', command: process.execPath, args: ['-e', 'process.exit(1)'], acp: true });
    expect(result.ok).toBe(false);
    expect(result.error).toBeTruthy();
  }, 15_000);
});
