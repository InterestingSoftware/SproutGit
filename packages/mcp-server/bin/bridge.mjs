#!/usr/bin/env node
// stdio<->socket bridge for SproutGit's MCP server.
//
// Most MCP-capable CLI agents (Claude Code, Gemini CLI, Codex CLI, Kiro CLI)
// only know how to spawn a command and speak JSON-RPC over its stdin/stdout
// (the standard MCP "stdio" transport) — they can't connect to a Unix socket
// or Windows named pipe directly. This script is that spawned command: it
// connects to the socket/pipe for one running SproutGit workspace and
// proxies raw bytes between its own stdio and that connection. It carries no
// protocol knowledge of its own and has zero dependencies, so it runs under
// plain `node` with no build step — the actual MCP server logic lives in the
// Electron app, listening on the other end of the socket.
//
// Usage: node bridge.mjs <socket-or-pipe-path>

import { connect } from 'node:net';

const socketPath = process.argv[2];

if (!socketPath) {
  process.stderr.write('Usage: bridge.mjs <socket-or-pipe-path>\n');
  process.exit(1);
}

const socket = connect(socketPath);

socket.on('connect', () => {
  process.stdin.pipe(socket);
  socket.pipe(process.stdout);
});

socket.on('error', (error) => {
  process.stderr.write(`sproutgit-mcp-bridge: failed to connect to ${socketPath}: ${error.message}\n`);
  process.exit(1);
});

socket.on('close', () => {
  process.exit(0);
});

process.stdin.on('error', () => { /* EPIPE etc. when the parent MCP client exits — nothing to clean up */ });
process.on('SIGTERM', () => { socket.destroy(); process.exit(0); });
process.on('SIGINT', () => { socket.destroy(); process.exit(0); });
