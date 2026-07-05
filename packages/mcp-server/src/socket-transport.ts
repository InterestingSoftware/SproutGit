import type { Socket } from 'node:net';
import type { Transport } from '@modelcontextprotocol/sdk/shared/transport.js';
import type { JSONRPCMessage } from '@modelcontextprotocol/sdk/types.js';

/**
 * MCP `Transport` over a raw `net.Socket`, framing each JSON-RPC message as
 * one line of JSON followed by `\n` — the same newline-delimited framing
 * `StdioServerTransport` uses. That wire compatibility is deliberate: the
 * stdio bridge script (bin/bridge.mjs) that MCP clients spawn is a dumb
 * byte proxy between its own stdio and this socket, so both ends must agree
 * on framing without either side needing the MCP SDK.
 */
export class SocketServerTransport implements Transport {
  onclose?: () => void;
  onerror?: (error: Error) => void;
  onmessage?: (message: JSONRPCMessage) => void;

  private buffer = '';
  private started = false;

  constructor(private readonly socket: Socket) {}

  start(): Promise<void> {
    if (this.started) return Promise.reject(new Error('SocketServerTransport already started'));
    this.started = true;
    this.socket.setEncoding('utf8');
    this.socket.on('data', (chunk: string) => this.handleData(chunk));
    this.socket.on('close', () => this.onclose?.());
    this.socket.on('error', (error: Error) => this.onerror?.(error));
    return Promise.resolve();
  }

  private handleData(chunk: string): void {
    this.buffer += chunk;
    let newlineIndex: number;
    while ((newlineIndex = this.buffer.indexOf('\n')) >= 0) {
      const line = this.buffer.slice(0, newlineIndex);
      this.buffer = this.buffer.slice(newlineIndex + 1);
      if (!line.trim()) continue;
      try {
        this.onmessage?.(JSON.parse(line) as JSONRPCMessage);
      } catch (error) {
        this.onerror?.(error instanceof Error ? error : new Error(String(error)));
      }
    }
  }

  send(message: JSONRPCMessage): Promise<void> {
    return new Promise((resolve, reject) => {
      this.socket.write(`${JSON.stringify(message)}\n`, (error) => {
        if (error) reject(error); else resolve();
      });
    });
  }

  close(): Promise<void> {
    this.socket.end();
    return Promise.resolve();
  }
}
