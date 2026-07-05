import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { McpServerContext } from './context.js';
import { registerTools } from './tools.js';

/** Package version reported to MCP clients during the initialize handshake. */
const SERVER_VERSION = '0.1.0';

/**
 * Builds a fresh `McpServer` with the full SproutGit tool set registered
 * against `context`. Callers create one of these per accepted connection
 * (see `mcp-bridge.ts` in the main process) rather than sharing a single
 * instance across clients — the SDK's `McpServer.connect()` takes ownership
 * of exactly one transport.
 */
export function createMcpServer(context: McpServerContext): McpServer {
  const server = new McpServer(
    { name: 'sproutgit', version: SERVER_VERSION },
    { capabilities: { tools: {} } },
  );
  registerTools(server, context);
  return server;
}
