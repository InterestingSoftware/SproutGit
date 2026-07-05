/**
 * Auto-configuration writers for MCP-capable agent CLIs, plus a manual
 * fallback snippet for any client not handled here. Each writer points the
 * client directly at this workspace's HTTP endpoint
 * (`http://127.0.0.1:<port>/mcp`) with the per-workspace bearer token in a
 * header — no spawned process, so nothing here depends on the user having
 * Node (or anything else) on their system PATH.
 *
 * Config locations/schemas here reflect each tool's actual, verified
 * convention for a remote/HTTP MCP server as of this writing:
 *   - Claude Code:  project-level `.mcp.json` — `{"type":"http","url":...,"headers":{...}}`.
 *   - Cursor:       project-level `.cursor/mcp.json` — `{"url":...,"headers":{...}}`.
 *   - Kiro:         workspace-level `.kiro/settings/mcp.json` — `{"url":...,"headers":{...}}`
 *                   (there's also a user-level file that merges in with
 *                   workspace taking precedence — we write the workspace one).
 *   - Gemini CLI:   user-level `~/.gemini/settings.json`, under `mcpServers`,
 *                   using `httpUrl` (not `url`, which Gemini reserves for SSE).
 *   - Codex CLI:    user-level `~/.codex/config.toml`, `[mcp_servers.<name>]`
 *                   with `url` and a `http_headers` inline table.
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { basename, dirname, join } from 'node:path';
import { homedir } from 'node:os';
import type { McpClientId, McpConfigWriteResult } from '@sproutgit/types';

/** MCP server name used in per-workspace config files (Claude, Cursor, Kiro). */
const SERVER_NAME = 'sproutgit';

/**
 * Gemini and Codex configs are user-level, not workspace-level, so a plain
 * "sproutgit" key would collide across multiple open workspaces and each
 * write would silently clobber the previous workspace's entry. Disambiguate
 * with the workspace's directory name.
 */
function globalServerName(workspacePath: string): string {
  const base = basename(workspacePath).replace(/[^a-zA-Z0-9_-]+/g, '-').toLowerCase();
  return `sproutgit-${base || 'workspace'}`;
}

function serverUrl(port: number): string {
  return `http://127.0.0.1:${port}/mcp`;
}

function authHeaders(token: string): Record<string, string> {
  return { Authorization: `Bearer ${token}` };
}

// ── JSON config merge (Claude, Cursor, Kiro, Gemini) ────────────────────────

function upsertJsonMcpServer(configPath: string, serverName: string, serverConfig: Record<string, unknown>): void {
  let parsed: Record<string, unknown> = {};
  if (existsSync(configPath)) {
    try {
      parsed = JSON.parse(readFileSync(configPath, 'utf8')) as Record<string, unknown>;
    } catch {
      // Malformed existing file — treat as empty rather than clobbering it
      // silently; the merge below still preserves nothing but at least
      // doesn't crash the write.
      parsed = {};
    }
  }
  const existingServers = (parsed['mcpServers'] as Record<string, unknown> | undefined) ?? {};
  parsed['mcpServers'] = { ...existingServers, [serverName]: serverConfig };
  mkdirSync(dirname(configPath), { recursive: true });
  writeFileSync(configPath, `${JSON.stringify(parsed, null, 2)}\n`);
}

// ── Minimal TOML table upsert (Codex) ───────────────────────────────────────
// Deliberately narrow: only replaces/appends one flat `[tableName]` block by
// text span, leaving the rest of the file untouched. Good enough for a
// `[mcp_servers.<name>]` table of string/inline-table values — not a
// general TOML writer.

type TomlValue = string | Record<string, string>;

function tomlString(value: string): string {
  return `"${value.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`;
}

function tomlValue(value: TomlValue): string {
  if (typeof value === 'string') return tomlString(value);
  const entries = Object.entries(value).map(([k, v]) => `${tomlString(k)} = ${tomlString(v)}`);
  return `{ ${entries.join(', ')} }`;
}

function upsertTomlTable(fileContent: string, tableName: string, entries: Record<string, TomlValue>): string {
  const header = `[${tableName}]`;
  const block = [header, ...Object.entries(entries).map(([key, value]) => `${key} = ${tomlValue(value)}`)];

  const lines = fileContent.length > 0 ? fileContent.split('\n') : [];
  const headerIndex = lines.findIndex(line => line.trim() === header);

  if (headerIndex === -1) {
    const prefix = fileContent.trim().length > 0 ? `${fileContent.replace(/\n+$/, '')}\n\n` : '';
    return `${prefix}${block.join('\n')}\n`;
  }

  let endIndex = lines.length;
  for (let i = headerIndex + 1; i < lines.length; i++) {
    if (/^\s*\[/.test(lines[i] ?? '')) { endIndex = i; break; }
  }
  return [...lines.slice(0, headerIndex), ...block, ...lines.slice(endIndex)].join('\n');
}

// ── Public API ───────────────────────────────────────────────────────────────

export function writeClientConfig(workspacePath: string, client: McpClientId, port: number, token: string): McpConfigWriteResult {
  const url = serverUrl(port);
  const headers = authHeaders(token);

  switch (client) {
    case 'claude': {
      const configPath = join(workspacePath, '.mcp.json');
      upsertJsonMcpServer(configPath, SERVER_NAME, { type: 'http', url, headers });
      return { configPath };
    }
    case 'cursor': {
      const configPath = join(workspacePath, '.cursor', 'mcp.json');
      upsertJsonMcpServer(configPath, SERVER_NAME, { url, headers });
      return { configPath };
    }
    case 'kiro': {
      const configPath = join(workspacePath, '.kiro', 'settings', 'mcp.json');
      upsertJsonMcpServer(configPath, SERVER_NAME, { url, headers });
      return { configPath };
    }
    case 'gemini': {
      const configPath = join(homedir(), '.gemini', 'settings.json');
      upsertJsonMcpServer(configPath, globalServerName(workspacePath), { httpUrl: url, headers });
      return { configPath };
    }
    case 'codex': {
      const configPath = join(homedir(), '.codex', 'config.toml');
      const existing = existsSync(configPath) ? readFileSync(configPath, 'utf8') : '';
      const updated = upsertTomlTable(existing, `mcp_servers.${globalServerName(workspacePath)}`, { url, http_headers: headers });
      mkdirSync(dirname(configPath), { recursive: true });
      writeFileSync(configPath, updated);
      return { configPath };
    }
  }
}

/** JSON or TOML snippet for a user to paste into their own MCP client config by hand. */
export function buildManualSnippet(port: number, token: string, client?: McpClientId): string {
  const url = serverUrl(port);
  const headers = authHeaders(token);

  if (client === 'codex') {
    return `[mcp_servers.sproutgit]\nurl = ${tomlString(url)}\nhttp_headers = ${tomlValue(headers)}\n`;
  }
  const config = client === 'gemini' ? { httpUrl: url, headers }
    : client === 'claude' ? { type: 'http', url, headers }
    : { url, headers };
  return JSON.stringify({ mcpServers: { sproutgit: config } }, null, 2);
}
