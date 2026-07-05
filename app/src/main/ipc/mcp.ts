import { join } from 'node:path';
import { IPC } from '@sproutgit/types';
import type { McpClientId, McpServerStatus } from '@sproutgit/types';
import { openWorkspaceDb, eq } from '@sproutgit/database';
import { workspaceState } from '@sproutgit/database/schema/workspace';
import { handle } from './handle.js';
import { startMcpServer, stopMcpServer, getMcpStatus, resolveMcpSocketPath } from '../mcp-bridge.js';
import { writeClientConfig, buildManualSnippet } from '../mcp-config-writers.js';

/** Per-workspace key in the workspace_state table for the enable/disable toggle. */
const ENABLED_KEY = 'mcp:enabled';

function getWorkspaceDb(workspacePath: string) {
  return openWorkspaceDb(join(workspacePath, '.sproutgit', 'state.db'));
}

function readEnabled(workspacePath: string): boolean {
  const db = getWorkspaceDb(workspacePath);
  const row = db.select().from(workspaceState).where(eq(workspaceState.key, ENABLED_KEY)).get();
  return row?.value === 'true';
}

function writeEnabled(workspacePath: string, enabled: boolean): void {
  const db = getWorkspaceDb(workspacePath);
  db.insert(workspaceState)
    .values({ key: ENABLED_KEY, value: String(enabled) })
    .onConflictDoUpdate({ target: workspaceState.key, set: { value: String(enabled) } })
    .run();
}

function statusFor(workspacePath: string): McpServerStatus {
  return { ...getMcpStatus(workspacePath), enabled: readEnabled(workspacePath) };
}

function paramsFor(workspacePath: string) {
  return {
    workspacePath,
    gitRepoPath: join(workspacePath, '.sproutgit', 'root'),
    managedWorktreesPath: join(workspacePath, '.sproutgit', 'worktrees'),
  };
}

export function registerMcpHandlers(): void {
  handle(IPC.MCP_STATUS, (_e, workspacePath: string) => statusFor(workspacePath));

  // Called when a workspace opens — starts the socket server only if the
  // user previously enabled it for this workspace. Idempotent, like
  // watch:start, so it's safe to call unconditionally from the renderer's
  // workspace-mount effect.
  handle(IPC.MCP_ENSURE_STARTED, async (_e, workspacePath: string) => {
    if (readEnabled(workspacePath)) {
      await startMcpServer(paramsFor(workspacePath));
    }
    return statusFor(workspacePath);
  });

  handle(IPC.MCP_SET_ENABLED, async (_e, args: { workspacePath: string; enabled: boolean }) => {
    writeEnabled(args.workspacePath, args.enabled);
    if (args.enabled) {
      await startMcpServer(paramsFor(args.workspacePath));
    } else {
      await stopMcpServer(args.workspacePath);
    }
    return statusFor(args.workspacePath);
  });

  handle(IPC.MCP_WRITE_CLIENT_CONFIG, (_e, args: { workspacePath: string; client: McpClientId }) => {
    const status = getMcpStatus(args.workspacePath);
    if (!status.running || !status.socketPath) {
      throw new Error('The MCP server is not running for this workspace. Enable it first.');
    }
    return writeClientConfig(args.workspacePath, args.client, status.socketPath);
  });

  handle(IPC.MCP_GET_MANUAL_SNIPPET, (_e, args: { workspacePath: string; client?: McpClientId }) => {
    const status = getMcpStatus(args.workspacePath);
    const socketPath = status.socketPath ?? resolveMcpSocketPath(args.workspacePath);
    return buildManualSnippet(socketPath, args.client);
  });
}
