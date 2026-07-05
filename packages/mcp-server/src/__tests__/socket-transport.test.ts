import { describe, it, expect, afterEach } from 'vitest';
import { createServer, connect, type Server, type Socket } from 'node:net';
import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { SocketServerTransport } from '../socket-transport.js';

describe('SocketServerTransport', () => {
  let server: Server | undefined;
  let dir: string | undefined;

  afterEach(async () => {
    await new Promise<void>(resolve => server ? server.close(() => resolve()) : resolve());
    server = undefined;
    if (dir) rmSync(dir, { recursive: true, force: true });
    dir = undefined;
  });

  function socketPath(): string {
    dir = mkdtempSync(join(tmpdir(), 'sg-mcp-socket-test-'));
    return join(dir, 'test.sock');
  }

  it('frames outgoing messages as newline-delimited JSON', async () => {
    const path = socketPath();
    const received: string[] = [];

    await new Promise<void>(resolve => {
      server = createServer(socket => {
        socket.setEncoding('utf8');
        socket.on('data', (chunk: string) => received.push(chunk));
      });
      server.listen(path, resolve);
    });

    const client: Socket = await new Promise(resolve => {
      const s = connect(path, () => resolve(s));
    });

    const transport = new SocketServerTransport(client);
    await transport.start();
    await transport.send({ jsonrpc: '2.0', id: 1, result: { ok: true } });

    await new Promise(resolve => setTimeout(resolve, 50));
    expect(received.join('')).toBe('{"jsonrpc":"2.0","id":1,"result":{"ok":true}}\n');

    client.destroy();
  });

  it('parses incoming newline-delimited JSON, including a message split across chunks', async () => {
    const path = socketPath();
    const serverSocketPromise = new Promise<Socket>(resolveSocket => {
      server = createServer(socket => resolveSocket(socket));
    });
    await new Promise<void>(resolve => { server!.listen(path, resolve); });

    const client: Socket = await new Promise(resolve => {
      const s = connect(path, () => resolve(s));
    });
    const serverSocket = await serverSocketPromise;

    const transport = new SocketServerTransport(client);
    const messages: unknown[] = [];
    transport.onmessage = m => messages.push(m);
    await transport.start();

    const payload = `${JSON.stringify({ jsonrpc: '2.0', id: 2, method: 'ping' })}\n`;
    serverSocket.write(payload.slice(0, 5));
    serverSocket.write(payload.slice(5));

    await new Promise(resolve => setTimeout(resolve, 50));
    expect(messages).toEqual([{ jsonrpc: '2.0', id: 2, method: 'ping' }]);

    client.destroy();
  });

  it('invokes onclose when the socket closes', async () => {
    const path = socketPath();
    await new Promise<void>(resolve => {
      server = createServer(socket => socket.end());
      server.listen(path, resolve);
    });

    const client: Socket = await new Promise(resolve => {
      const s = connect(path, () => resolve(s));
    });

    const transport = new SocketServerTransport(client);
    const closed = new Promise<void>(resolve => { transport.onclose = () => resolve(); });
    await transport.start();

    await closed;
  });
});
