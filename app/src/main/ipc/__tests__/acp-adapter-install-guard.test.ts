import { tmpdir } from 'node:os';
import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const { handleMock, installAcpAdapterMock } = vi.hoisted(() => ({
  handleMock: vi.fn(),
  installAcpAdapterMock: vi.fn(),
}));
vi.mock('electron', () => ({ ipcMain: { handle: handleMock } }));
vi.mock('../../telemetry.js', () => ({ log: { error: vi.fn(), info: vi.fn(), warn: vi.fn() } }));
vi.mock('../terminal.js', () => ({ manager: { spawn: vi.fn() }, sessionWindows: new Map() }));
vi.mock('../acp-adapters.js', async importOriginal => ({
  ...(await importOriginal<typeof import('../acp-adapters.js')>()),
  installAcpAdapter: installAcpAdapterMock,
}));

import { IPC } from '@sproutgit/types';
import { openConfigDb, type ConfigDb } from '@sproutgit/database';
import { registerAgentHandlers } from '../agents.js';

type Handler = (event: unknown, npmPackage: string) => Promise<void>;

function getHandler(configDb: ConfigDb, userDataPath: string): Handler {
  handleMock.mockClear();
  registerAgentHandlers(configDb, () => null, userDataPath);
  const call = handleMock.mock.calls.find(c => c[0] === IPC.AGENT_ACP_ADAPTER_INSTALL);
  if (!call) throw new Error(`${IPC.AGENT_ACP_ADAPTER_INSTALL} handler was not registered`);
  return call[1] as Handler;
}

describe('AGENT_ACP_ADAPTER_INSTALL', () => {
  let tmpDir: string;
  let configDb: ConfigDb;

  beforeEach(() => {
    installAcpAdapterMock.mockReset();
    installAcpAdapterMock.mockResolvedValue(undefined);
    tmpDir = mkdtempSync(join(tmpdir(), 'sg-test-acp-install-guard-'));
    configDb = openConfigDb(join(tmpDir, 'config.db'));
  });

  afterEach(() => {
    configDb.close();
    rmSync(tmpDir, { recursive: true, force: true });
  });

  it('rejects an npmPackage that is not one of the known ACP adapters, without ever calling installAcpAdapter', async () => {
    const handler = getHandler(configDb, tmpDir);
    await expect(handler({}, 'some-malicious-package')).rejects.toThrow(/Refusing to install unrecognized package/);
    expect(installAcpAdapterMock).not.toHaveBeenCalled();
  });

  it('rejects a lookalike scoped package that merely contains a known package name as a substring', async () => {
    const handler = getHandler(configDb, tmpDir);
    await expect(handler({}, '@evil/@agentclientprotocol/claude-agent-acp')).rejects.toThrow(/Refusing to install unrecognized package/);
    expect(installAcpAdapterMock).not.toHaveBeenCalled();
  });

  it('installs a known adapter package', async () => {
    const handler = getHandler(configDb, tmpDir);
    await handler({}, '@agentclientprotocol/claude-agent-acp');
    expect(installAcpAdapterMock).toHaveBeenCalledWith(tmpDir, '@agentclientprotocol/claude-agent-acp', expect.any(Function));
  });

  it('installs the other known adapter package', async () => {
    const handler = getHandler(configDb, tmpDir);
    await handler({}, '@agentclientprotocol/codex-acp');
    expect(installAcpAdapterMock).toHaveBeenCalledWith(tmpDir, '@agentclientprotocol/codex-acp', expect.any(Function));
  });
});
