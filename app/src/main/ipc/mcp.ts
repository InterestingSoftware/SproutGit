import { join } from 'node:path';
import { randomBytes } from 'node:crypto';
import { BrowserWindow } from 'electron';
import { IPC } from '@sproutgit/types';
import type { McpClientId, McpServerStatus } from '@sproutgit/types';
import { openWorkspaceDb, eq, type ConfigDb } from '@sproutgit/database';
import { workspaceState } from '@sproutgit/database/schema/workspace';
import { handle } from './handle.js';
import { startMcpServer, stopMcpServer, getMcpStatus, deriveDefaultPort } from '../mcp-bridge.js';
import { writeClientConfig, buildManualSnippet } from '../mcp-config-writers.js';

/** Per-workspace keys in the workspace_state table. */
const ENABLED_KEY = 'mcp:enabled';
const PORT_KEY = 'mcp:port';
const TOKEN_KEY = 'mcp:token';

function getWorkspaceDb(workspacePath: string) {
  return openWorkspaceDb(join(workspacePath, '.sproutgit', 'state.db'));
}

// Each of these opens its own short-lived db connection rather than caching
// one (unlike workspace.ts's per-workspace cache) — these are infrequent,
// one-off reads/writes, not per-frame hot paths. But an unclosed sqlite
// handle holds a WAL lock, and on Windows that also blocks deleting/renaming
// the file out from under it — always close before returning.

function readState(workspacePath: string, key: string): string | null {
  const db = getWorkspaceDb(workspacePath);
  try {
    return db.select().from(workspaceState).where(eq(workspaceState.key, key)).get()?.value ?? null;
  } finally {
    db.close();
  }
}

function writeState(workspacePath: string, key: string, value: string): void {
  const db = getWorkspaceDb(workspacePath);
  try {
    db.insert(workspaceState)
      .values({ key, value })
      .onConflictDoUpdate({ target: workspaceState.key, set: { value } })
      .run();
  } finally {
    db.close();
  }
}

function deleteState(workspacePath: string, key: string): void {
  const db = getWorkspaceDb(workspacePath);
  try {
    db.delete(workspaceState).where(eq(workspaceState.key, key)).run();
  } finally {
    db.close();
  }
}

function readEnabled(workspacePath: string): boolean {
  return readState(workspacePath, ENABLED_KEY) === 'true';
}

function effectivePort(workspacePath: string): number {
  const override = readState(workspacePath, PORT_KEY);
  return override ? Number(override) : deriveDefaultPort(workspacePath);
}

/** Generated once per workspace and persisted — a token that changes on every restart would invalidate every client config already written for that workspace. */
function readOrCreateToken(workspacePath: string): string {
  const existing = readState(workspacePath, TOKEN_KEY);
  if (existing) return existing;
  const token = randomBytes(32).toString('hex');
  writeState(workspacePath, TOKEN_KEY, token);
  return token;
}

function statusFor(workspacePath: string): McpServerStatus {
  return { ...getMcpStatus(workspacePath), port: effectivePort(workspacePath), enabled: readEnabled(workspacePath) };
}

function paramsFor(workspacePath: string) {
  return {
    workspacePath,
    gitRepoPath: join(workspacePath, '.sproutgit', 'root'),
    managedWorktreesPath: join(workspacePath, '.sproutgit', 'worktrees'),
    port: effectivePort(workspacePath),
    token: readOrCreateToken(workspacePath),
  };
}

export function registerMcpHandlers(configDb: ConfigDb): void {
  handle(IPC.MCP_STATUS, (_e, workspacePath: string) => statusFor(workspacePath));

  // Called when a workspace opens — starts the server only if the user
  // previously enabled it for this workspace. Idempotent, like watch:start,
  // so it's safe to call unconditionally from the renderer's
  // workspace-mount effect.
  handle(IPC.MCP_ENSURE_STARTED, async (_e, workspacePath: string) => {
    if (readEnabled(workspacePath)) {
      await startMcpServer(paramsFor(workspacePath), () => BrowserWindow.fromWebContents(_e.sender), configDb);
    }
    return statusFor(workspacePath);
  });

  handle(IPC.MCP_SET_ENABLED, async (_e, args: { workspacePath: string; enabled: boolean }) => {
    writeState(args.workspacePath, ENABLED_KEY, String(args.enabled));
    if (args.enabled) {
      await startMcpServer(paramsFor(args.workspacePath), () => BrowserWindow.fromWebContents(_e.sender), configDb);
    } else {
      await stopMcpServer(args.workspacePath);
    }
    return statusFor(args.workspacePath);
  });

  // `port: null` resets to the derived per-workspace default. Restarts the
  // server on the new port immediately if it's currently running, rather
  // than requiring the user to toggle it off/on — if binding the new port
  // fails (e.g. still in use), the error propagates so the renderer can
  // surface it instead of silently leaving the old port running.
  handle(IPC.MCP_SET_PORT, async (_e, args: { workspacePath: string; port: number | null }) => {
    if (args.port === null) {
      deleteState(args.workspacePath, PORT_KEY);
    } else {
      writeState(args.workspacePath, PORT_KEY, String(args.port));
    }
    if (getMcpStatus(args.workspacePath).running) {
      await stopMcpServer(args.workspacePath);
      await startMcpServer(paramsFor(args.workspacePath), () => BrowserWindow.fromWebContents(_e.sender), configDb);
    }
    return statusFor(args.workspacePath);
  });

  handle(IPC.MCP_WRITE_CLIENT_CONFIG, (_e, args: { workspacePath: string; client: McpClientId }) => {
    const status = statusFor(args.workspacePath);
    if (!status.enabled) {
      throw new Error('The MCP server is not enabled for this workspace. Enable it first.');
    }
    return writeClientConfig(args.workspacePath, args.client, status.port, readOrCreateToken(args.workspacePath));
  });

  handle(IPC.MCP_GET_MANUAL_SNIPPET, (_e, args: { workspacePath: string; client?: McpClientId }) => {
    const port = effectivePort(args.workspacePath);
    const token = readOrCreateToken(args.workspacePath);
    return buildManualSnippet(port, token, args.client);
  });
}
