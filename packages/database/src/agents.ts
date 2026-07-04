import type { AgentConfig } from '@sproutgit/types';
import { eq } from 'drizzle-orm';
import type { ConfigDb } from './config-db.js';
import { settings } from './schema/config.js';

const AGENT_CONFIG_KEY = 'agentConfig';

/** Default agent config seeded into the config DB on first read — Claude Code, Integrated mode. */
export function getDefaultAgentConfig(): AgentConfig {
  return { command: 'claude', args: [], mode: 'integrated' };
}

function isAgentConfig(value: unknown): value is AgentConfig {
  if (!value || typeof value !== 'object') return false;
  const a = value as Record<string, unknown>;
  return typeof a['command'] === 'string'
    && Array.isArray(a['args'])
    && a['args'].every(arg => typeof arg === 'string')
    && (a['mode'] === 'integrated' || a['mode'] === 'terminal');
}

/** Parses the stored `agentConfig` JSON, returning null if it's corrupted or malformed. */
function parseStoredConfig(value: string): AgentConfig | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(value);
  } catch {
    return null;
  }
  return isAgentConfig(parsed) ? parsed : null;
}

/**
 * Reads the single configured AI agent from the config DB, seeding the
 * default (Claude Code, Integrated) on first read, and re-seeding (and
 * persisting the fix) if the stored value is missing, corrupted, or doesn't
 * match the expected shape.
 */
export function getAgentConfig(db: ConfigDb): AgentConfig {
  const row = db.select().from(settings).where(eq(settings.key, AGENT_CONFIG_KEY)).get();
  const parsed = row ? parseStoredConfig(row.value) : null;
  if (parsed) return parsed;

  const seeded = getDefaultAgentConfig();
  saveAgentConfig(db, seeded);
  return seeded;
}

/** Persists the single configured AI agent. */
export function saveAgentConfig(db: ConfigDb, config: AgentConfig): void {
  db
    .insert(settings)
    .values({ key: AGENT_CONFIG_KEY, value: JSON.stringify(config) })
    .onConflictDoUpdate({ target: settings.key, set: { value: JSON.stringify(config) } })
    .run();
}
