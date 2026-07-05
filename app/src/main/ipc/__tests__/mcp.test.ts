import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync, readFileSync, realpathSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { IPC } from '@sproutgit/types';
import type { McpServerStatus } from '@sproutgit/types';

const { handleMock } = vi.hoisted(() => ({ handleMock: vi.fn() }));
vi.mock('electron', () => ({
  ipcMain: { handle: handleMock },
  BrowserWindow: { fromWebContents: (sender: unknown) => sender ?? null },
}));

import { registerMcpHandlers } from '../mcp.js';
import { stopAllMcpServers, deriveDefaultPort } from '../../mcp-bridge.js';

type AnyHandler = (event: unknown, ...args: unknown[]) => unknown;

function registerAndGetHandlers(): (channel: string) => AnyHandler {
  handleMock.mockClear();
  registerMcpHandlers();
  return (channel: string) => {
    const call = handleMock.mock.calls.find(c => c[0] === channel);
    if (!call) throw new Error(`${channel} handler was not registered`);
    return call[1] as AnyHandler;
  };
}

function tempWorkspace(): string {
  return realpathSync.native(mkdtempSync(join(tmpdir(), 'sg-mcp-ipc-test-')));
}

describe('mcp IPC handlers', () => {
  let workspacePath: string;
  let getHandler: (channel: string) => AnyHandler;

  beforeEach(() => {
    workspacePath = tempWorkspace();
    getHandler = registerAndGetHandlers();
  });

  afterEach(async () => {
    await stopAllMcpServers();
    rmSync(workspacePath, { recursive: true, force: true });
  });

  it('reports a fresh workspace as disabled, not running, with the derived default port', async () => {
    const status = await getHandler(IPC.MCP_STATUS)({}, workspacePath) as McpServerStatus;
    expect(status).toEqual({ enabled: false, running: false, port: deriveDefaultPort(workspacePath) });
  });

  it('mcp:ensureStarted is a no-op when never enabled', async () => {
    const status = await getHandler(IPC.MCP_ENSURE_STARTED)({}, workspacePath) as McpServerStatus;
    expect(status.running).toBe(false);
  });

  it('mcp:setEnabled(true) starts a real server; mcp:setEnabled(false) stops it', async () => {
    const enabled = await getHandler(IPC.MCP_SET_ENABLED)({}, { workspacePath, enabled: true }) as McpServerStatus;
    expect(enabled.enabled).toBe(true);
    expect(enabled.running).toBe(true);

    const res = await fetch(`http://127.0.0.1:${enabled.port}/mcp`);
    expect(res.status).toBe(401); // reachable, requires auth — the real app is serving, not a stub

    const disabled = await getHandler(IPC.MCP_SET_ENABLED)({}, { workspacePath, enabled: false }) as McpServerStatus;
    expect(disabled.enabled).toBe(false);
    expect(disabled.running).toBe(false);
  });

  it('mcp:ensureStarted starts the server on a fresh handler registration once enabled was persisted (simulates an app restart with MCP left enabled)', async () => {
    await getHandler(IPC.MCP_SET_ENABLED)({}, { workspacePath, enabled: true });
    await stopAllMcpServers(); // simulate the app quitting without the user disabling MCP first

    getHandler = registerAndGetHandlers(); // simulate re-registering handlers on the next app start
    const status = await getHandler(IPC.MCP_ENSURE_STARTED)({}, workspacePath) as McpServerStatus;
    expect(status.enabled).toBe(true);
    expect(status.running).toBe(true);
  });

  it('mcp:setPort persists an override and is reflected in status even while not running', async () => {
    const custom = deriveDefaultPort(workspacePath) === 50000 ? 50001 : 50000;
    const status = await getHandler(IPC.MCP_SET_PORT)({}, { workspacePath, port: custom }) as McpServerStatus;
    expect(status.port).toBe(custom);
    expect(status.running).toBe(false);
  });

  it('mcp:setPort(null) resets to the derived default', async () => {
    await getHandler(IPC.MCP_SET_PORT)({}, { workspacePath, port: 51234 });
    const status = await getHandler(IPC.MCP_SET_PORT)({}, { workspacePath, port: null }) as McpServerStatus;
    expect(status.port).toBe(deriveDefaultPort(workspacePath));
  });

  it('mcp:setPort restarts an already-running server on the new port', async () => {
    const started = await getHandler(IPC.MCP_SET_ENABLED)({}, { workspacePath, enabled: true }) as McpServerStatus;
    const oldPort = started.port;
    const newPort = oldPort === 52000 ? 52001 : 52000;

    const status = await getHandler(IPC.MCP_SET_PORT)({}, { workspacePath, port: newPort }) as McpServerStatus;
    expect(status.running).toBe(true);
    expect(status.port).toBe(newPort);

    await expect(fetch(`http://127.0.0.1:${oldPort}/mcp`, { signal: AbortSignal.timeout(500) })).rejects.toThrow();
    const res = await fetch(`http://127.0.0.1:${newPort}/mcp`);
    expect(res.status).toBe(401);
  });

  it('mcp:writeClientConfig refuses when not enabled', async () => {
    await expect(getHandler(IPC.MCP_WRITE_CLIENT_CONFIG)({}, { workspacePath, client: 'cursor' }))
      .rejects.toThrow(/not enabled/);
  });

  it('mcp:writeClientConfig writes a real config file once enabled, embedding the current port and a token', async () => {
    const status = await getHandler(IPC.MCP_SET_ENABLED)({}, { workspacePath, enabled: true }) as McpServerStatus;
    const result = await getHandler(IPC.MCP_WRITE_CLIENT_CONFIG)({}, { workspacePath, client: 'cursor' }) as { configPath: string };
    const parsed = JSON.parse(readFileSync(result.configPath, 'utf8'));
    expect(parsed.mcpServers.sproutgit.url).toBe(`http://127.0.0.1:${status.port}/mcp`);
    expect(parsed.mcpServers.sproutgit.headers.Authorization).toMatch(/^Bearer [0-9a-f]{64}$/);
  });

  it('the generated token is stable across calls (persisted, not regenerated per request)', async () => {
    const snippet1 = await getHandler(IPC.MCP_GET_MANUAL_SNIPPET)({}, { workspacePath }) as string;
    const snippet2 = await getHandler(IPC.MCP_GET_MANUAL_SNIPPET)({}, { workspacePath }) as string;
    const token1 = (JSON.parse(snippet1) as { mcpServers: { sproutgit: { headers: { Authorization: string } } } }).mcpServers.sproutgit.headers.Authorization;
    const token2 = (JSON.parse(snippet2) as { mcpServers: { sproutgit: { headers: { Authorization: string } } } }).mcpServers.sproutgit.headers.Authorization;
    expect(token1).toBe(token2);
  });
});
