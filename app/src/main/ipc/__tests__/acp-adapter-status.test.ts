import { tmpdir } from 'node:os';
import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { AcpAdapterStatus } from '@sproutgit/types';

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
import { openConfigDb, saveAgentConfig, type ConfigDb } from '@sproutgit/database';
import { registerAgentHandlers } from '../agents.js';

type Handler = () => Promise<AcpAdapterStatus | null>;

function getHandler(configDb: ConfigDb, userDataPath: string): Handler {
  handleMock.mockClear();
  registerAgentHandlers(configDb, userDataPath);
  const call = handleMock.mock.calls.find(c => c[0] === IPC.AGENT_ACP_ADAPTER_STATUS);
  if (!call) throw new Error(`${IPC.AGENT_ACP_ADAPTER_STATUS} handler was not registered`);
  return call[1] as Handler;
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
    saveAgentConfig(configDb, { command: 'gemini', args: [], mode: 'terminal' });
    const handler = getHandler(configDb, tmpDir);
    expect(await handler()).toBeNull();
  });

  it('reports npmAvailable: false and installed: false when neither the adapter nor npm is on PATH', async () => {
    saveAgentConfig(configDb, { command: 'claude', args: [], mode: 'terminal' });
    resolveCommandPathMock.mockResolvedValue(null);
    const handler = getHandler(configDb, tmpDir);
    expect(await handler()).toEqual({
      npmPackage: '@agentclientprotocol/claude-agent-acp',
      label: 'Claude Code',
      bin: 'claude-agent-acp',
      installed: false,
      approxSizeMb: 220,
      npmAvailable: false,
    });
  });

  it('reports npmAvailable: true and installed: true when both resolve', async () => {
    saveAgentConfig(configDb, { command: 'codex', args: [], mode: 'terminal' });
    resolveCommandPathMock.mockImplementation((cmd: string) =>
      Promise.resolve(cmd === 'npm' ? '/usr/local/bin/npm' : '/usr/local/bin/codex-acp'));
    const handler = getHandler(configDb, tmpDir);
    const status = await handler();
    expect(status).toMatchObject({ installed: true, npmAvailable: true });
  });
});
