/**
 * Owns the lifecycle of one MCP (Model Context Protocol) HTTP server per
 * currently-open workspace. Each server:
 *  - binds to `127.0.0.1` only (never `0.0.0.0`) on a per-workspace port,
 *  - validates the `Host` header (via the SDK's `createMcpExpressApp`) to
 *    defeat DNS-rebinding attacks from a malicious webpage,
 *  - requires a per-workspace bearer token, to defend against other local
 *    processes — a loopback TCP port, unlike a Unix socket, is reachable by
 *    any process on the machine regardless of which user owns it.
 *
 * MCP clients that support the "http"/"streamable-http" transport type
 * connect directly to `http://127.0.0.1:<port>/mcp` with the token in an
 * `Authorization: Bearer` header — no spawned bridge process needed.
 */
import { createServer as createHttpServer, type Server } from 'node:http';
import { createHash } from 'node:crypto';
import type { AddressInfo } from 'node:net';
import type { BrowserWindow } from 'electron';
import type { ConfigDb } from '@sproutgit/database';
import { IPC } from '@sproutgit/types';
import { createHttpApp, type McpServerContext } from '@sproutgit/mcp-server';
import { log } from './telemetry.js';
import { createWorktreeWithHooks, removeWorktreeWithHooks } from './worktree-lifecycle.js';

export type McpServerParams = {
  workspacePath: string;
  gitRepoPath: string;
  managedWorktreesPath: string;
  port: number;
  token: string;
};

export type McpServerStatus = {
  running: boolean;
  port: number | null;
};

type RunningServer = {
  server: Server;
  port: number;
};

const runningServers = new Map<string, RunningServer>();

// A stable, per-workspace default so the port doesn't drift across app
// restarts (which would otherwise silently invalidate every client config
// already written for that workspace). Multiple concurrently open
// workspaces get distinct derived defaults instead of all colliding on one
// fixed port; if a derived default still collides with something else on
// the machine, the user can override it in Settings.
const DEFAULT_PORT_BASE = 45_000;
const DEFAULT_PORT_RANGE = 1_000;

export function deriveDefaultPort(workspacePath: string): number {
  const hash = createHash('sha256').update(workspacePath).digest();
  return DEFAULT_PORT_BASE + (hash.readUInt32BE(0) % DEFAULT_PORT_RANGE);
}

/**
 * Starts (or returns the already-running) MCP HTTP server for a workspace.
 * Idempotent — safe to call on every workspace-open even if a server is
 * already up for that path. Throws (with a clearer message for the common
 * case) if the port can't be bound — deliberately does NOT fall back to a
 * different port silently, since that would break any client config already
 * written against the requested one.
 */
export async function startMcpServer(
  params: McpServerParams,
  getWindow: () => BrowserWindow | null,
  configDb: ConfigDb,
): Promise<number> {
  const existing = runningServers.get(params.workspacePath);
  if (existing) return existing.port;

  const context: McpServerContext = {
    workspacePath: params.workspacePath,
    gitRepoPath: params.gitRepoPath,
    managedWorktreesPath: params.managedWorktreesPath,
    // TODO: wire to a real per-workspace/global permission setting once a
    // Settings UI for enabling mutating MCP tools exists. Until then,
    // create_worktree/remove_worktree are implemented but always refuse.
    mutatingToolsEnabled: () => false,
    // Both point at the exact same functions the renderer's worktree:create/
    // worktree:delete IPC handlers use (see ipc/git.ts) — an MCP-driven
    // worktree change runs the same hooks and provenance recording as a
    // UI-driven one. initiatingWorktreePath is null here since an MCP call
    // has no "worktree currently in view" the way the UI does.
    createWorktree: args => createWorktreeWithHooks({
      workspacePath: params.workspacePath,
      rootRepoPath: params.gitRepoPath,
      managedWorktreesPath: params.managedWorktreesPath,
      fromRef: args.fromRef,
      newBranch: args.newBranch,
      initiatingWorktreePath: null,
    }, getWindow, configDb),
    removeWorktree: async args => {
      await removeWorktreeWithHooks({
        workspacePath: params.workspacePath,
        rootRepoPath: params.gitRepoPath,
        managedWorktreesPath: params.managedWorktreesPath,
        worktreePath: args.worktreePath,
        deleteBranch: args.deleteBranch,
        branchName: args.branchName ?? null,
        initiatingWorktreePath: null,
      }, getWindow, configDb);
    },
    // Purely a UI notification — pushed straight to the renderer, nothing to
    // persist. Silently a no-op if the workspace's window isn't open (e.g.
    // it was closed after an agent started working), same as other
    // best-effort main→renderer pushes in this codebase.
    reportSessionDone: async args => {
      const win = getWindow();
      if (win && !win.isDestroyed()) {
        win.webContents.send(IPC.EVENT_MCP_SESSION_DONE, { worktreePath: args.worktreePath, summary: args.summary });
      }
    },
  };

  const app = createHttpApp(context, params.token);
  const server = createHttpServer(app);

  let boundPort: number;
  try {
    boundPort = await new Promise<number>((resolve, reject) => {
      server.once('error', reject);
      server.listen(params.port, '127.0.0.1', () => {
        server.removeListener('error', reject);
        // Reads back the OS-assigned port rather than trusting params.port
        // verbatim — identical in the normal case (a specific port was
        // requested and bound), but also correct if ever called with port 0.
        const address = server.address() as AddressInfo;
        resolve(address.port);
      });
    });
  } catch (error) {
    const isPortInUse = error instanceof Error && 'code' in error && error.code === 'EADDRINUSE';
    throw isPortInUse
      ? new Error(`Port ${params.port} is already in use. Change the MCP server port for this workspace in Settings.`, { cause: error })
      : error;
  }

  server.on('error', (error: Error) => log.error(`[mcp-bridge] http server error for ${params.workspacePath}`, error));

  runningServers.set(params.workspacePath, { server, port: boundPort });
  log.info(`[mcp-bridge] started for ${params.workspacePath} on 127.0.0.1:${boundPort}`);
  return boundPort;
}

/** Stops the MCP server for a workspace, if one is running. Idempotent. */
export async function stopMcpServer(workspacePath: string): Promise<void> {
  const running = runningServers.get(workspacePath);
  if (!running) return;
  runningServers.delete(workspacePath);
  await new Promise<void>(resolve => running.server.close(() => resolve()));
  log.info(`[mcp-bridge] stopped for ${workspacePath}`);
}

export function getMcpStatus(workspacePath: string): McpServerStatus {
  const running = runningServers.get(workspacePath);
  return { running: !!running, port: running?.port ?? null };
}

/** Stops every running MCP server — used on app quit. */
export async function stopAllMcpServers(): Promise<void> {
  await Promise.all([...runningServers.keys()].map(stopMcpServer));
}
