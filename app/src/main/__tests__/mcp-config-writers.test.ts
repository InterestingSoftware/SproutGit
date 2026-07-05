import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { writeClientConfig, buildManualSnippet } from '../mcp-config-writers.js';

const PORT = 47285;
const TOKEN = 'test-token-abc123';
const URL = `http://127.0.0.1:${PORT}/mcp`;
const HEADERS = { Authorization: `Bearer ${TOKEN}` };

describe('mcp-config-writers', () => {
  let workspaceDir: string;
  let homeDir: string;
  let originalHome: string | undefined;

  beforeEach(() => {
    workspaceDir = mkdtempSync(join(tmpdir(), 'sg-mcp-cfg-ws-'));
    homeDir = mkdtempSync(join(tmpdir(), 'sg-mcp-cfg-home-'));
    // writeClientConfig calls node:os's homedir() directly for the
    // user-level clients (Gemini, Codex) — homedir() isn't memoized, so
    // overriding HOME redirects it for the duration of each test.
    originalHome = process.env['HOME'];
    process.env['HOME'] = homeDir;
  });

  afterEach(() => {
    rmSync(workspaceDir, { recursive: true, force: true });
    rmSync(homeDir, { recursive: true, force: true });
    if (originalHome === undefined) delete process.env['HOME'];
    else process.env['HOME'] = originalHome;
  });

  it('writes Claude Code .mcp.json with type "http", url, and headers', () => {
    const result = writeClientConfig(workspaceDir, 'claude', PORT, TOKEN);
    expect(result.configPath).toBe(join(workspaceDir, '.mcp.json'));
    const parsed = JSON.parse(readFileSync(result.configPath, 'utf8'));
    expect(parsed.mcpServers.sproutgit).toEqual({ type: 'http', url: URL, headers: HEADERS });
  });

  it('writes Cursor .cursor/mcp.json with url/headers and no type field', () => {
    const result = writeClientConfig(workspaceDir, 'cursor', PORT, TOKEN);
    expect(result.configPath).toBe(join(workspaceDir, '.cursor', 'mcp.json'));
    const parsed = JSON.parse(readFileSync(result.configPath, 'utf8'));
    expect(parsed.mcpServers.sproutgit).toEqual({ url: URL, headers: HEADERS });
  });

  it('writes Kiro .kiro/settings/mcp.json with url/headers', () => {
    const result = writeClientConfig(workspaceDir, 'kiro', PORT, TOKEN);
    expect(result.configPath).toBe(join(workspaceDir, '.kiro', 'settings', 'mcp.json'));
    const parsed = JSON.parse(readFileSync(result.configPath, 'utf8'));
    expect(parsed.mcpServers.sproutgit).toEqual({ url: URL, headers: HEADERS });
  });

  it('writes Gemini ~/.gemini/settings.json using httpUrl, not url', () => {
    const result = writeClientConfig(workspaceDir, 'gemini', PORT, TOKEN);
    expect(result.configPath).toBe(join(homeDir, '.gemini', 'settings.json'));
    const parsed = JSON.parse(readFileSync(result.configPath, 'utf8'));
    const serverNames = Object.keys(parsed.mcpServers);
    expect(serverNames).toHaveLength(1);
    expect(serverNames[0]).toMatch(/^sproutgit-/);
    expect(parsed.mcpServers[serverNames[0]!]).toEqual({ httpUrl: URL, headers: HEADERS });
  });

  it('writes Codex ~/.codex/config.toml with url + http_headers inline table', () => {
    const result = writeClientConfig(workspaceDir, 'codex', PORT, TOKEN);
    expect(result.configPath).toBe(join(homeDir, '.codex', 'config.toml'));
    const content = readFileSync(result.configPath, 'utf8');
    expect(content).toMatch(/^\[mcp_servers\.sproutgit-[a-z0-9-]+\]$/m);
    expect(content).toContain(`url = "${URL}"`);
    expect(content).toContain(`http_headers = { "Authorization" = "Bearer ${TOKEN}" }`);
  });

  it('disambiguates Gemini/Codex server names per workspace (user-level file, would otherwise collide)', () => {
    const otherWorkspace = mkdtempSync(join(tmpdir(), 'sg-mcp-cfg-ws2-'));
    try {
      writeClientConfig(workspaceDir, 'gemini', PORT, TOKEN);
      writeClientConfig(otherWorkspace, 'gemini', PORT, TOKEN);
      const configPath = join(homeDir, '.gemini', 'settings.json');
      const parsed = JSON.parse(readFileSync(configPath, 'utf8'));
      expect(Object.keys(parsed.mcpServers)).toHaveLength(2);
    } finally {
      rmSync(otherWorkspace, { recursive: true, force: true });
    }
  });

  it('preserves unrelated existing JSON content when merging (Claude)', () => {
    const configPath = join(workspaceDir, '.mcp.json');
    writeFileSync(configPath, JSON.stringify({
      someOtherTopLevelKey: 'keep-me',
      mcpServers: { 'another-server': { type: 'stdio', command: 'foo' } },
    }));

    writeClientConfig(workspaceDir, 'claude', PORT, TOKEN);

    const parsed = JSON.parse(readFileSync(configPath, 'utf8'));
    expect(parsed.someOtherTopLevelKey).toBe('keep-me');
    expect(parsed.mcpServers['another-server']).toEqual({ type: 'stdio', command: 'foo' });
    expect(parsed.mcpServers.sproutgit).toEqual({ type: 'http', url: URL, headers: HEADERS });
  });

  it('preserves unrelated existing TOML content and updates (not duplicates) its own section on re-write', () => {
    const configDir = join(homeDir, '.codex');
    mkdirSync(configDir, { recursive: true });
    const configPath = join(configDir, 'config.toml');
    writeFileSync(configPath, '[some_other_table]\nfoo = "bar"\n');

    writeClientConfig(workspaceDir, 'codex', PORT, TOKEN);
    writeClientConfig(workspaceDir, 'codex', PORT + 1, TOKEN); // re-write with a different port

    const content = readFileSync(configPath, 'utf8');
    expect(content).toContain('[some_other_table]');
    expect(content).toContain('foo = "bar"');
    expect(content.match(/\[mcp_servers\./g)).toHaveLength(1); // updated in place, not appended again
    expect(content).toContain(`url = "http://127.0.0.1:${PORT + 1}/mcp"`);
  });

  it('builds a manual JSON snippet defaulting to plain url/headers when no client is given', () => {
    const snippet = buildManualSnippet(PORT, TOKEN);
    expect(JSON.parse(snippet)).toEqual({ mcpServers: { sproutgit: { url: URL, headers: HEADERS } } });
  });

  it('builds a manual snippet matching the Gemini httpUrl shape', () => {
    const snippet = buildManualSnippet(PORT, TOKEN, 'gemini');
    expect(JSON.parse(snippet)).toEqual({ mcpServers: { sproutgit: { httpUrl: URL, headers: HEADERS } } });
  });

  it('builds a manual snippet matching the Codex TOML shape', () => {
    const snippet = buildManualSnippet(PORT, TOKEN, 'codex');
    expect(snippet).toContain('[mcp_servers.sproutgit]');
    expect(snippet).toContain(`url = "${URL}"`);
    expect(snippet).toContain(`http_headers = { "Authorization" = "Bearer ${TOKEN}" }`);
  });
});
