/**
 * Owns the lifecycle of one MCP (Model Context Protocol) socket server per
 * currently-open workspace. Each server listens on a Unix domain socket
 * (macOS/Linux) or a named pipe (Windows) — no bearer token needed, since
 * OS-level file/pipe permissions already scope access to the local user
 * account, which is the correct trust model for a local-only desktop app.
 *
 * `net.createServer().listen(path)` handles the Unix-socket-vs-named-pipe
 * distinction transparently based on the path format, so this module never
 * branches on platform except to compute that path in the first place.
 *
 * MCP clients that expect a stdio transport (most CLI agents) don't connect
 * here directly — they spawn the bridge script at
 * `packages/mcp-server/bin/bridge.mjs`, which proxies its own stdio to this
 * socket. See that file for the wire format (newline-delimited JSON, shared
 * with `SocketServerTransport`).
 */
import { createServer, connect as netConnect, type Server, type Socket } from 'node:net';
import { createHash } from 'node:crypto';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { mkdirSync, unlinkSync, existsSync } from 'node:fs';
import { createMcpServer, SocketServerTransport, type McpServerContext } from '@sproutgit/mcp-server';
import { log } from './telemetry.js';

export type McpServerParams = {
  workspacePath: string;
  gitRepoPath: string;
  managedWorktreesPath: string;
};

export type McpServerStatus = {
  running: boolean;
  socketPath: string | null;
};

type RunningServer = {
  server: Server;
  socketPath: string;
};

const runningServers = new Map<string, RunningServer>();

// Conservative bound below the real platform limits (~104 bytes on macOS,
// ~108 on Linux) to leave headroom for the null terminator and any prefix
// the OS adds — long workspace paths (deeply nested project directories)
// can otherwise silently fail to bind.
const UNIX_SOCKET_PATH_MAX = 100;

function hashOf(value: string): string {
  return createHash('sha256').update(value).digest('hex').slice(0, 16);
}

/**
 * Computes the socket/pipe path for a workspace. Prefers a path inside the
 * workspace's own `.sproutgit/` directory (correctly scoped permissions by
 * construction) but falls back to a hashed name under the OS temp dir when
 * that path would exceed the Unix socket path length limit. Windows named
 * pipes live in a global namespace rather than the filesystem, so they're
 * always hashed.
 */
export function resolveMcpSocketPath(workspacePath: string): string {
  if (process.platform === 'win32') {
    return `\\\\.\\pipe\\sproutgit-mcp-${hashOf(workspacePath)}`;
  }
  const preferred = join(workspacePath, '.sproutgit', 'mcp.sock');
  if (preferred.length <= UNIX_SOCKET_PATH_MAX) return preferred;
  return join(tmpdir(), `sproutgit-mcp-${hashOf(workspacePath)}.sock`);
}

/**
 * True when `socketPath` is a leftover file from a previous run that
 * crashed or was killed before it could clean up — i.e. nothing is actually
 * listening on it. `net.Server.listen()` fails with EADDRINUSE against a
 * stale socket file even though no process holds it, so this must be
 * checked (and the file removed) before binding.
 */
function isStaleSocket(socketPath: string): Promise<boolean> {
  if (process.platform === 'win32' || !existsSync(socketPath)) return Promise.resolve(false);
  return new Promise(resolve => {
    const probe = netConnect(socketPath);
    probe.once('connect', () => { probe.destroy(); resolve(false); });
    probe.once('error', () => resolve(true));
  });
}

/**
 * Starts (or returns the already-running) MCP socket server for a
 * workspace. Idempotent — safe to call on every workspace-open even if a
 * server is already up for that path.
 */
export async function startMcpServer(params: McpServerParams): Promise<string> {
  const existing = runningServers.get(params.workspacePath);
  if (existing) return existing.socketPath;

  const socketPath = resolveMcpSocketPath(params.workspacePath);

  if (process.platform !== 'win32') {
    mkdirSync(dirname(socketPath), { recursive: true });
    if (await isStaleSocket(socketPath)) {
      try { unlinkSync(socketPath); } catch { /* already gone */ }
    }
  }

  const context: McpServerContext = {
    workspacePath: params.workspacePath,
    gitRepoPath: params.gitRepoPath,
    managedWorktreesPath: params.managedWorktreesPath,
    // TODO: wire to a real per-workspace/global permission setting once a
    // Settings UI for enabling mutating MCP tools exists. Until then,
    // create_worktree/remove_worktree are implemented but always refuse.
    mutatingToolsEnabled: () => false,
  };

  // Each connection gets its own McpServer instance: the SDK's
  // `connect()` takes ownership of exactly one transport, and a socket
  // server may see more than one client (or a reconnect) over its lifetime.
  const server = createServer((socket: Socket) => {
    const transport = new SocketServerTransport(socket);
    createMcpServer(context).connect(transport).catch((error: unknown) => {
      log.error(`[mcp-bridge] failed to connect MCP server for ${params.workspacePath}`, error);
      socket.destroy();
    });
  });

  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(socketPath, () => {
      server.removeListener('error', reject);
      resolve();
    });
  });

  server.on('error', (error: Error) => log.error(`[mcp-bridge] socket server error for ${params.workspacePath}`, error));

  runningServers.set(params.workspacePath, { server, socketPath });
  log.info(`[mcp-bridge] started for ${params.workspacePath} at ${socketPath}`);
  return socketPath;
}

/** Stops the MCP socket server for a workspace, if one is running. Idempotent. */
export async function stopMcpServer(workspacePath: string): Promise<void> {
  const running = runningServers.get(workspacePath);
  if (!running) return;
  runningServers.delete(workspacePath);
  await new Promise<void>(resolve => running.server.close(() => resolve()));
  if (process.platform !== 'win32') {
    try { unlinkSync(running.socketPath); } catch { /* already gone */ }
  }
  log.info(`[mcp-bridge] stopped for ${workspacePath}`);
}

export function getMcpStatus(workspacePath: string): McpServerStatus {
  const running = runningServers.get(workspacePath);
  return { running: !!running, socketPath: running?.socketPath ?? null };
}

/** Stops every running MCP server — used on app quit. */
export async function stopAllMcpServers(): Promise<void> {
  await Promise.all([...runningServers.keys()].map(stopMcpServer));
}
