import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { execSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync, realpathSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { createServer, request as httpRequest, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import type { McpServerContext } from '../context.js';
import { createHttpApp } from '../http-server.js';

/**
 * Parses a Streamable HTTP response body, which the SDK may send as either
 * plain JSON or a single SSE `data:` event depending on internal content
 * negotiation — either way there's exactly one JSON-RPC message in it.
 */
function parseJsonRpcBody(text: string): unknown {
  const dataLine = text.split('\n').find(line => line.startsWith('data: '));
  return JSON.parse(dataLine ? dataLine.slice('data: '.length) : text);
}

/**
 * Sends a raw request with an explicit Host header. `fetch` refuses to let
 * callers override Host (it's a forbidden header per the Fetch spec, same
 * as in real browsers) — exactly the property that makes the SDK's Host
 * validation an effective DNS-rebinding defense, but it means this specific
 * spoofing test needs Node's raw `http.request` instead of `fetch`.
 */
function requestWithHostHeader(url: string, host: string, body: string): Promise<{ status: number }> {
  return new Promise((resolve, reject) => {
    const { hostname, port, pathname } = new URL(url);
    const req = httpRequest({
      hostname,
      port,
      path: pathname,
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        accept: 'application/json, text/event-stream',
        authorization: `Bearer ${TOKEN}`,
        host,
        'content-length': Buffer.byteLength(body),
      },
    }, res => {
      res.resume();
      res.on('end', () => resolve({ status: res.statusCode ?? 0 }));
    });
    req.on('error', reject);
    req.end(body);
  });
}

function initTestRepo(): string {
  const dir = realpathSync.native(mkdtempSync(join(tmpdir(), 'sg-mcp-http-test-')));
  execSync('git init', { cwd: dir, stdio: 'ignore' });
  execSync('git config user.email "test@sproutgit.test"', { cwd: dir, stdio: 'ignore' });
  execSync('git config user.name "SproutGit Test"', { cwd: dir, stdio: 'ignore' });
  writeFileSync(join(dir, 'README.md'), '# Test Repo\n');
  execSync('git add .', { cwd: dir, stdio: 'ignore' });
  execSync('git commit -m "initial commit"', { cwd: dir, stdio: 'ignore' });
  return dir;
}

const TOKEN = 'test-token-123';

describe('createHttpApp', () => {
  let repoPath: string;
  let server: Server;
  let baseUrl: string;

  beforeAll(async () => {
    repoPath = initTestRepo();
    mkdirSync(join(repoPath, '.sproutgit', 'worktrees'), { recursive: true });
    const context: McpServerContext = {
      workspacePath: repoPath,
      gitRepoPath: repoPath,
      managedWorktreesPath: join(repoPath, '.sproutgit', 'worktrees'),
      mutatingToolsEnabled: () => false,
      // Never actually invoked by this file's tests (only initialize +
      // tools/list are exercised, not tools/call) — stubbed just to satisfy
      // the type.
      createWorktree: () => { throw new Error('not implemented in this test'); },
      removeWorktree: () => { throw new Error('not implemented in this test'); },
      reportSessionDone: () => { throw new Error('not implemented in this test'); },
      listHooks: () => { throw new Error('not implemented in this test'); },
      listHookRuns: () => { throw new Error('not implemented in this test'); },
      createLocalHook: () => { throw new Error('not implemented in this test'); },
      updateLocalHook: () => { throw new Error('not implemented in this test'); },
      deleteLocalHook: () => { throw new Error('not implemented in this test'); },
      toggleLocalHook: () => { throw new Error('not implemented in this test'); },
      runHook: () => { throw new Error('not implemented in this test'); },
    };
    const app = createHttpApp(context, TOKEN);
    server = createServer(app);
    await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
    const { port } = server.address() as AddressInfo;
    baseUrl = `http://127.0.0.1:${port}`;
  });

  afterAll(async () => {
    await new Promise<void>(resolve => server.close(() => resolve()));
    rmSync(repoPath, { recursive: true, force: true });
  });

  it('rejects a request with no Authorization header', async () => {
    const res = await fetch(`${baseUrl}/mcp`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', accept: 'application/json, text/event-stream' },
      body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/list', params: {} }),
    });
    expect(res.status).toBe(401);
  });

  it('rejects a request with the wrong token', async () => {
    const res = await fetch(`${baseUrl}/mcp`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        accept: 'application/json, text/event-stream',
        authorization: 'Bearer wrong-token',
      },
      body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/list', params: {} }),
    });
    expect(res.status).toBe(401);
  });

  it.each([
    ['a token that is a prefix of the real one', `Bearer ${TOKEN.slice(0, -1)}`],
    ['a token longer than the real one', `Bearer ${TOKEN}-extra`],
    ['a token differing only in the last character', `Bearer ${TOKEN.slice(0, -1)}X`],
    ['an empty token', 'Bearer '],
    ['a missing "Bearer " prefix', TOKEN],
    ['the wrong auth scheme', `Basic ${TOKEN}`],
  ])('rejects %s', async (_description, authorization) => {
    const res = await fetch(`${baseUrl}/mcp`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        accept: 'application/json, text/event-stream',
        authorization,
      },
      body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/list', params: {} }),
    });
    expect(res.status).toBe(401);
  });

  it('rejects a mismatched Host header (DNS-rebinding protection)', async () => {
    const body = JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/list', params: {} });
    const res = await requestWithHostHeader(`${baseUrl}/mcp`, 'evil.example.com', body);
    expect(res.status).toBe(403);
  });

  it('rejects GET and DELETE on /mcp', async () => {
    const get = await fetch(`${baseUrl}/mcp`, { headers: { authorization: `Bearer ${TOKEN}` } });
    expect(get.status).toBe(405);
    const del = await fetch(`${baseUrl}/mcp`, { method: 'DELETE', headers: { authorization: `Bearer ${TOKEN}` } });
    expect(del.status).toBe(405);
  });

  it('serves an initialize + tools/list round trip with a valid token', async () => {
    const init = await fetch(`${baseUrl}/mcp`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        accept: 'application/json, text/event-stream',
        authorization: `Bearer ${TOKEN}`,
      },
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: 1,
        method: 'initialize',
        params: { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'test', version: '0' } },
      }),
    });
    expect(init.status).toBe(200);
    const initBody = parseJsonRpcBody(await init.text()) as { result?: { serverInfo?: { name?: string } } };
    expect(initBody.result?.serverInfo?.name).toBe('sproutgit');

    const listTools = await fetch(`${baseUrl}/mcp`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        accept: 'application/json, text/event-stream',
        authorization: `Bearer ${TOKEN}`,
      },
      body: JSON.stringify({ jsonrpc: '2.0', id: 2, method: 'tools/list', params: {} }),
    });
    expect(listTools.status).toBe(200);
    const listBody = parseJsonRpcBody(await listTools.text()) as { result: { tools: Array<{ name: string }> } };
    const names = listBody.result.tools.map(t => t.name);
    expect(names).toEqual(expect.arrayContaining([
      'list_worktrees', 'get_worktree_status', 'get_worktree_diff', 'get_workspace_info',
      'report_session_done', 'create_worktree', 'remove_worktree',
      'list_hooks', 'list_hook_runs', 'create_local_hook', 'update_local_hook', 'delete_local_hook',
      'toggle_local_hook', 'run_hook',
    ]));
  });
});
