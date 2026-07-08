import { tmpdir } from 'node:os';
import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { AcpAdapterStatus, AgentRoster } from '@sproutgit/types';

const { handleMock, resolveCommandPathMock } = vi.hoisted(() => ({
  handleMock: vi.fn(),
  resolveCommandPathMock: vi.fn(),
}));
vi.mock('electron', () => ({ ipcMain: { handle: handleMock } }));
vi.mock('../../telemetry.js', () => ({ log: { error: vi.fn(), info: vi.fn(), warn: vi.fn() } }));
vi.mock('../terminal.js', () => ({ manager: { spawn: vi.fn() }, sessionWindows: new Map() }));
vi.mock('../tool-test-helpers.js', async importOriginal => ({
  ...(await importOriginal<typeof import('../tool-test-helpers.js')>()),
  resolveCommandPath: resolveCommandPathMock,
}));

import { IPC } from '@sproutgit/types';
import { openConfigDb, saveAgentRoster, type ConfigDb } from '@sproutgit/database';
import { registerAgentHandlers } from '../agents.js';

type Handler = (agentId: string) => Promise<AcpAdapterStatus | null>;

function getHandler(configDb: ConfigDb, userDataPath: string): Handler {
  handleMock.mockClear();
  registerAgentHandlers(configDb, userDataPath);
  const call = handleMock.mock.calls.find(c => c[0] === IPC.AGENT_ACP_ADAPTER_STATUS);
  if (!call) throw new Error(`${IPC.AGENT_ACP_ADAPTER_STATUS} handler was not registered`);
  return call[1] as Handler;
}

function rosterFor(command: string): AgentRoster {
  return { agents: [{ id: 'a', name: 'Agent', command, args: [], env: {}, mode: 'terminal', acp: true }], defaultAgentId: 'a' };
}

describe('AGENT_ACP_ADAPTER_STATUS', () => {
  let tmpDir: string;
  let configDb: ConfigDb;

  beforeEach(() => {
    resolveCommandPathMock.mockReset();
    tmpDir = mkdtempSync(join(tmpdir(), 'sg-test-acp-status-'));
    configDb = openConfigDb(join(tmpDir, 'config.db'));
  });

  afterEach(() => {
    configDb.close();
    rmSync(tmpDir, { recursive: true, force: true });
  });

  it('returns null for a command that does not need a separate adapter', async () => {
    saveAgentRoster(configDb, rosterFor('gemini'));
    const handler = getHandler(configDb, tmpDir);
    expect(await handler('a')).toBeNull();
  });

  it('reports npmAvailable: false and installed: false when neither the adapter nor npm is on PATH', async () => {
    saveAgentRoster(configDb, rosterFor('claude'));
    resolveCommandPathMock.mockResolvedValue(null);
    const handler = getHandler(configDb, tmpDir);
    expect(await handler('a')).toEqual({
      npmPackage: '@agentclientprotocol/claude-agent-acp',
      label: 'Claude Code',
      bin: 'claude-agent-acp',
      installed: false,
      approxSizeMb: 220,
      npmAvailable: false,
    });
  });

  it('reports npmAvailable: true and installed: true when both resolve', async () => {
    saveAgentRoster(configDb, rosterFor('codex'));
    resolveCommandPathMock.mockImplementation((cmd: string) =>
      Promise.resolve(cmd === 'npm' ? '/usr/local/bin/npm' : '/usr/local/bin/codex-acp'));
    const handler = getHandler(configDb, tmpDir);
    const status = await handler('a');
    expect(status).toMatchObject({ installed: true, npmAvailable: true });
  });
});
