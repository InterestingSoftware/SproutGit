import { describe, it, expect, afterEach } from 'vitest';
import { execSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync, realpathSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { startMcpServer, stopMcpServer, getMcpStatus, deriveDefaultPort } from '../mcp-bridge.js';

function initTestRepo(): string {
  const dir = realpathSync.native(mkdtempSync(join(tmpdir(), 'sg-mcp-bridge-test-')));
  execSync('git init', { cwd: dir, stdio: 'ignore' });
  execSync('git config user.email "test@sproutgit.test"', { cwd: dir, stdio: 'ignore' });
  execSync('git config user.name "SproutGit Test"', { cwd: dir, stdio: 'ignore' });
  writeFileSync(join(dir, 'README.md'), '# Test\n');
  execSync('git add .', { cwd: dir, stdio: 'ignore' });
  execSync('git commit -m init', { cwd: dir, stdio: 'ignore' });
  mkdirSync(join(dir, '.sproutgit', 'worktrees'), { recursive: true });
  return dir;
}

function paramsFor(workspacePath: string, port = 0) {
  return {
    workspacePath,
    gitRepoPath: workspacePath,
    managedWorktreesPath: join(workspacePath, '.sproutgit', 'worktrees'),
    port,
    token: 'test-token',
  };
}

/** No workspace window is open in any of these tests — hooks are simply skipped, matching production behavior when a workspace has no open window. */
const NO_WINDOW = () => null;

describe('deriveDefaultPort', () => {
  it('is deterministic for the same workspace path', () => {
    expect(deriveDefaultPort('/some/workspace')).toBe(deriveDefaultPort('/some/workspace'));
  });

  it('differs across workspace paths (no default collision for concurrently open workspaces)', () => {
    expect(deriveDefaultPort('/workspace/one')).not.toBe(deriveDefaultPort('/workspace/two'));
  });

  it('stays within a bounded, valid TCP port range', () => {
    for (const path of ['/a', '/b/c', '/very/long/nested/workspace/path/name']) {
      const port = deriveDefaultPort(path);
      expect(port).toBeGreaterThanOrEqual(1024);
      expect(port).toBeLessThan(65536);
    }
  });
});

describe('mcp-bridge lifecycle', () => {
  const repos: string[] = [];

  afterEach(async () => {
    await Promise.all(repos.map(r => stopMcpServer(r)));
    for (const r of repos) rmSync(r, { recursive: true, force: true });
    repos.length = 0;
  });

  it('starts a real HTTP server reachable at the returned port, and reports it as running', async () => {
    const repo = initTestRepo();
    repos.push(repo);

    const port = await startMcpServer(paramsFor(repo), NO_WINDOW);
    expect(port).toBeGreaterThan(0);
    expect(getMcpStatus(repo)).toEqual({ running: true, port });

    const res = await fetch(`http://127.0.0.1:${port}/mcp`, { headers: { authorization: 'Bearer wrong' } });
    expect(res.status).toBe(401); // reachable and serving the real app, not just an open socket
  });

  it('is idempotent — a second start call for the same workspace returns the same port without rebinding', async () => {
    const repo = initTestRepo();
    repos.push(repo);

    const first = await startMcpServer(paramsFor(repo, 0), NO_WINDOW);
    const second = await startMcpServer(paramsFor(repo, 12345), NO_WINDOW); // different requested port, ignored since already running
    expect(second).toBe(first);
  });

  it('reports not running after stop, and stop is idempotent', async () => {
    const repo = initTestRepo();
    repos.push(repo);

    const port = await startMcpServer(paramsFor(repo), NO_WINDOW);
    await stopMcpServer(repo);
    expect(getMcpStatus(repo)).toEqual({ running: false, port: null });
    await stopMcpServer(repo); // no-op, must not throw

    // The port is actually released, not just forgotten about internally.
    await expect(fetch(`http://127.0.0.1:${port}/mcp`, { signal: AbortSignal.timeout(500) })).rejects.toThrow();
  });

  it('throws a clear, actionable error when the requested port is already bound', async () => {
    const repoA = initTestRepo();
    const repoB = initTestRepo();
    repos.push(repoA, repoB);

    const port = await startMcpServer(paramsFor(repoA, 0), NO_WINDOW);
    await expect(startMcpServer(paramsFor(repoB, port), NO_WINDOW)).rejects.toThrow(/already in use/);
    expect(getMcpStatus(repoB)).toEqual({ running: false, port: null });
  });

  it('getMcpStatus reports not running for a workspace that was never started', () => {
    expect(getMcpStatus('/never/started')).toEqual({ running: false, port: null });
  });
});
