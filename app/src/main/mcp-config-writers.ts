/**
 * Auto-configuration writers for MCP-capable agent CLIs, plus a manual
 * fallback snippet for any client not handled here. Each writer points the
 * client at the stdio bridge script (`packages/mcp-server/bin/bridge.mjs`)
 * with this workspace's socket/pipe path as its one argument — the bridge
 * itself is a dumb proxy, so every client config just needs to spawn
 * `node <bridge path> <socket path>`.
 *
 * Config locations/schemas here reflect each tool's actual convention as of
 * this writing:
 *   - Claude Code:  project-level `.mcp.json` at the workspace root.
 *   - Gemini CLI:   user-level `~/.gemini/settings.json`, under `mcpServers`.
 *   - Codex CLI:    user-level `~/.codex/config.toml`, `[mcp_servers.<name>]`.
 *   - Cursor:       project-level `.cursor/mcp.json` at the workspace root.
 *   - Kiro:         workspace-level `.kiro/settings/mcp.json` (there's also a
 *                   user-level file that merges in with workspace taking
 *                   precedence — we write the workspace one).
 */
import { app } from 'electron';
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

/**
 * Absolute path to the stdio bridge script. In dev, main-process code is
 * bundled to `app/out/main/`, three directories below the repo root. In a
 * packaged build the script is copied to `resources/mcp-bridge/` via
 * electron-builder's `extraResources` (see app/package.json).
 */
export function resolveBridgeScriptPath(): string {
  if (app.isPackaged) {
    return join(process.resourcesPath, 'mcp-bridge', 'bridge.mjs');
  }
  return join(__dirname, '..', '..', '..', 'packages', 'mcp-server', 'bin', 'bridge.mjs');
}

function bridgeServerConfig(socketPath: string): { command: string; args: string[] } {
  return { command: 'node', args: [resolveBridgeScriptPath(), socketPath] };
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
// `[mcp_servers.<name>]` table of string/array-of-string values — not a
// general TOML writer.

function tomlString(value: string): string {
  return `"${value.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`;
}

function tomlValue(value: string | string[]): string {
  return Array.isArray(value) ? `[${value.map(tomlString).join(', ')}]` : tomlString(value);
}

function upsertTomlTable(fileContent: string, tableName: string, entries: Record<string, string | string[]>): string {
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

export function writeClientConfig(workspacePath: string, client: McpClientId, socketPath: string): McpConfigWriteResult {
  const serverConfig = bridgeServerConfig(socketPath);

  switch (client) {
    case 'claude': {
      const configPath = join(workspacePath, '.mcp.json');
      upsertJsonMcpServer(configPath, SERVER_NAME, { type: 'stdio', ...serverConfig });
      return { configPath };
    }
    case 'cursor': {
      const configPath = join(workspacePath, '.cursor', 'mcp.json');
      upsertJsonMcpServer(configPath, SERVER_NAME, serverConfig);
      return { configPath };
    }
    case 'kiro': {
      const configPath = join(workspacePath, '.kiro', 'settings', 'mcp.json');
      upsertJsonMcpServer(configPath, SERVER_NAME, serverConfig);
      return { configPath };
    }
    case 'gemini': {
      const configPath = join(homedir(), '.gemini', 'settings.json');
      upsertJsonMcpServer(configPath, globalServerName(workspacePath), serverConfig);
      return { configPath };
    }
    case 'codex': {
      const configPath = join(homedir(), '.codex', 'config.toml');
      const existing = existsSync(configPath) ? readFileSync(configPath, 'utf8') : '';
      const updated = upsertTomlTable(existing, `mcp_servers.${globalServerName(workspacePath)}`, serverConfig);
      mkdirSync(dirname(configPath), { recursive: true });
      writeFileSync(configPath, updated);
      return { configPath };
    }
  }
}

/** JSON or TOML snippet for a user to paste into their own MCP client config by hand. */
export function buildManualSnippet(socketPath: string, client?: McpClientId): string {
  const { command, args } = bridgeServerConfig(socketPath);
  if (client === 'codex') {
    return `[mcp_servers.sproutgit]\ncommand = ${tomlString(command)}\nargs = [${args.map(tomlString).join(', ')}]\n`;
  }
  const config = client === 'claude' ? { type: 'stdio', command, args } : { command, args };
  return JSON.stringify({ mcpServers: { sproutgit: config } }, null, 2);
}
