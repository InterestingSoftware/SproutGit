import { createMcpExpressApp } from '@modelcontextprotocol/sdk/server/express.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import type { Transport } from '@modelcontextprotocol/sdk/shared/transport.js';
import type { Express, Request, Response, NextFunction } from 'express';
import type { McpServerContext } from './context.js';
import { createMcpServer } from './server.js';

const JSONRPC_UNAUTHORIZED = { jsonrpc: '2.0' as const, error: { code: -32001, message: 'Unauthorized' }, id: null };
const JSONRPC_METHOD_NOT_ALLOWED = { jsonrpc: '2.0' as const, error: { code: -32000, message: 'Method not allowed.' }, id: null };

function methodNotAllowed(_req: Request, res: Response): void {
  res.status(405).json(JSONRPC_METHOD_NOT_ALLOWED);
}

/**
 * Builds the Express app that serves one workspace's MCP tools over HTTP.
 *
 * Two layers of protection, since this binds to a loopback TCP port rather
 * than a Unix socket scoped by filesystem permissions:
 *  - `createMcpExpressApp()` (from the SDK) validates the `Host` header
 *    against `127.0.0.1`/`localhost`/`::1`, which defeats DNS rebinding —
 *    a malicious webpage can get a browser to resolve some domain to
 *    127.0.0.1, but it can't make the browser send a Host header that lies
 *    about that.
 *  - The bearer-token check below defends against other local processes on
 *    the same machine, since a loopback TCP port (unlike a Unix socket) is
 *    reachable by any process regardless of which user owns it.
 *
 * Stateless mode (`sessionIdGenerator: undefined`) — a fresh McpServer +
 * transport per request, matching the SDK's own
 * `examples/server/simpleStatelessStreamableHttp` pattern. There's no need
 * for stateful sessions here: every tool call is a one-shot request against
 * live workspace state, not a multi-turn streamed conversation.
 */
export function createHttpApp(context: McpServerContext, token: string): Express {
  const app = createMcpExpressApp();

  app.use((req: Request, res: Response, next: NextFunction) => {
    if (req.headers.authorization !== `Bearer ${token}`) {
      res.status(401).json(JSONRPC_UNAUTHORIZED);
      return;
    }
    next();
  });

  app.post('/mcp', async (req: Request, res: Response) => {
    try {
      // Key omitted (rather than set to `undefined`) for stateless mode —
      // same runtime effect, but satisfies this repo's
      // `exactOptionalPropertyTypes` under the SDK's own option type.
      const transport = new StreamableHTTPServerTransport({});
      const server = createMcpServer(context);
      res.on('close', () => {
        void transport.close();
        void server.close();
      });
      // StreamableHTTPServerTransport's own accessors (e.g. `onclose`) are
      // typed as `(() => void) | undefined`, which exactOptionalPropertyTypes
      // treats as incompatible with Transport's plain-optional `onclose?:`
      // slot — a mismatch between the SDK's authoring and this repo's strict
      // tsconfig, not a real behavioral gap (the class does implement
      // Transport's contract).
      await server.connect(transport as Transport);
      await transport.handleRequest(req, res, req.body as unknown);
    } catch (error) {
      if (!res.headersSent) {
        res.status(500).json({
          jsonrpc: '2.0',
          error: { code: -32603, message: error instanceof Error ? error.message : String(error) },
          id: null,
        });
      }
    }
  });

  app.get('/mcp', methodNotAllowed);
  app.delete('/mcp', methodNotAllowed);

  return app;
}
