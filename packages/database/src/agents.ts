import type { AgentConfig, AgentRoster, AgentRosterEntry } from '@sproutgit/types';
import { ACP_CAPABLE_TOKENS } from '@sproutgit/types';
import { randomUUID } from 'node:crypto';
import { eq } from 'drizzle-orm';
import type { ConfigDb } from './config-db.js';
import { settings } from './schema/config.js';

/** Legacy (pre-roster) single-agent setting key — read once as a migration source, never written to again. */
const LEGACY_AGENT_CONFIG_KEY = 'agentConfig';
const AGENT_ROSTER_KEY = 'agentRoster';

/** Default agent config seeded into the config DB on first read — Claude Code, Integrated mode. Kept for the legacy migration path and existing tests. */
export function getDefaultAgentConfig(): AgentConfig {
  return { command: 'claude', args: [], mode: 'integrated' };
}

/** Mirrors app/src/main/ipc/agents.ts's commandToken() — the database layer can't import main-process code, so this is kept in sync by hand (both derive from the same ACP_CAPABLE_TOKENS list in @sproutgit/types). */
function commandToken(command: string): string {
  const trimmed = command.trim().replace(/^["']|["']$/g, '');
  return trimmed.split(/[\\/]/).pop()?.toLowerCase() ?? '';
}

function isRecognizedAcpCommand(command: string): boolean {
  return ACP_CAPABLE_TOKENS.includes(commandToken(command));
}

/** Default roster seeded when neither a roster nor a legacy single-agent config exists yet: one Claude Code entry, Integrated mode. */
export function getDefaultAgentRoster(): AgentRoster {
  const entry: AgentRosterEntry = {
    id: 'default',
    name: 'Claude Code',
    command: 'claude',
    args: [],
    env: {},
    mode: 'integrated',
    acp: true,
  };
  return { agents: [entry], defaultAgentId: entry.id };
}

function isAgentConfig(value: unknown): value is AgentConfig {
  if (!value || typeof value !== 'object') return false;
  const a = value as Record<string, unknown>;
  return typeof a['command'] === 'string'
    && Array.isArray(a['args'])
    && a['args'].every(arg => typeof arg === 'string')
    && (a['mode'] === 'integrated' || a['mode'] === 'terminal');
}

function isAgentRosterEntry(value: unknown): value is AgentRosterEntry {
  if (!value || typeof value !== 'object') return false;
  const a = value as Record<string, unknown>;
  return typeof a['id'] === 'string' && a['id'] !== ''
    && typeof a['name'] === 'string'
    && typeof a['command'] === 'string'
    && Array.isArray(a['args']) && a['args'].every(arg => typeof arg === 'string')
    && typeof a['env'] === 'object' && a['env'] !== null
    && Object.values(a['env'] as Record<string, unknown>).every(v => typeof v === 'string')
    && (a['mode'] === 'integrated' || a['mode'] === 'terminal')
    && typeof a['acp'] === 'boolean';
}

function isAgentRoster(value: unknown): value is AgentRoster {
  if (!value || typeof value !== 'object') return false;
  const r = value as Record<string, unknown>;
  if (!Array.isArray(r['agents']) || r['agents'].length === 0) return false;
  if (!r['agents'].every(isAgentRosterEntry)) return false;
  if (typeof r['defaultAgentId'] !== 'string') return false;
  return (r['agents'] as AgentRosterEntry[]).some(a => a.id === r['defaultAgentId']);
}

function parseStoredRoster(value: string): AgentRoster | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(value);
  } catch {
    return null;
  }
  return isAgentRoster(parsed) ? parsed : null;
}

function parseLegacyConfig(value: string): AgentConfig | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(value);
  } catch {
    return null;
  }
  return isAgentConfig(parsed) ? parsed : null;
}

/** Converts the legacy single-agent config into a one-entry roster, used as a one-time migration source. */
function rosterFromLegacyConfig(config: AgentConfig): AgentRoster {
  const entry: AgentRosterEntry = {
    id: randomUUID(),
    name: config.command.trim() || 'Agent',
    command: config.command,
    args: config.args,
    env: {},
    mode: config.mode,
    acp: isRecognizedAcpCommand(config.command),
  };
  return { agents: [entry], defaultAgentId: entry.id };
}

/**
 * Reads the agent roster from the config DB. On first read after upgrading
 * from the single-agent config, migrates the legacy `agentConfig` value (if
 * present and valid) into a one-entry roster and persists it under the new
 * `agentRoster` key — the legacy key itself is left untouched. Falls back to
 * seeding the default roster if there is neither a valid roster nor a valid
 * legacy config, and re-persists the fix if the stored roster is corrupted
 * or malformed.
 */
export function getAgentRoster(db: ConfigDb): AgentRoster {
  const rosterRow = db.select().from(settings).where(eq(settings.key, AGENT_ROSTER_KEY)).get();
  const parsedRoster = rosterRow ? parseStoredRoster(rosterRow.value) : null;
  if (parsedRoster) return parsedRoster;

  const legacyRow = db.select().from(settings).where(eq(settings.key, LEGACY_AGENT_CONFIG_KEY)).get();
  const legacyConfig = legacyRow ? parseLegacyConfig(legacyRow.value) : null;
  const migrated = legacyConfig ? rosterFromLegacyConfig(legacyConfig) : getDefaultAgentRoster();
  saveAgentRoster(db, migrated);
  return migrated;
}

/** Persists the agent roster. Throws if the roster is empty or `defaultAgentId` doesn't reference one of `agents` — callers must keep at least one agent and a valid default. */
export function saveAgentRoster(db: ConfigDb, roster: AgentRoster): void {
  if (!isAgentRoster(roster)) {
    throw new Error('Invalid agent roster: must contain at least one agent, and defaultAgentId must reference one of them.');
  }
  db
    .insert(settings)
    .values({ key: AGENT_ROSTER_KEY, value: JSON.stringify(roster) })
    .onConflictDoUpdate({ target: settings.key, set: { value: JSON.stringify(roster) } })
    .run();
}

/** Resolves the agent to use for a launch/chat/test action: the explicitly requested id if given and found, otherwise the roster's default agent, otherwise the first agent. */
export function resolveRosterAgent(roster: AgentRoster, agentId?: string): AgentRosterEntry {
  const byId = agentId ? roster.agents.find(a => a.id === agentId) : undefined;
  if (byId) return byId;
  return roster.agents.find(a => a.id === roster.defaultAgentId) ?? roster.agents[0]!;
}
