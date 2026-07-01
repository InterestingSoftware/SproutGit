import type { AgentRoster, CodingAgent } from '@sproutgit/types';
import { eq } from 'drizzle-orm';
import type { ConfigDb } from './config-db.js';
import { settings } from './schema/config.js';

const AGENTS_KEY = 'codingAgents';
const DEFAULT_AGENT_ID_KEY = 'defaultAgentId';

/**
 * Built-in agent presets seeded into the config DB on first read.
 * These are user-editable copies, not hardcoded — once seeded, the user's
 * saved roster (including any edits/removals) is authoritative.
 */
export function getDefaultAgentPresets(): CodingAgent[] {
  return [
    { id: 'claude-code', name: 'Claude Code', command: 'claude', args: [] },
    { id: 'kiro', name: 'Kiro', command: 'kiro', args: [] },
    { id: 'cursor', name: 'Cursor', command: 'cursor-agent', args: [] },
    { id: 'codex', name: 'Codex CLI', command: 'codex', args: [] },
    { id: 'gemini', name: 'Gemini CLI', command: 'gemini', args: [] },
    { id: 'custom', name: 'Custom', command: '', args: [] },
  ];
}

function defaultRoster(): AgentRoster {
  return { agents: getDefaultAgentPresets(), defaultAgentId: 'claude-code' };
}

function isCodingAgent(value: unknown): value is CodingAgent {
  if (!value || typeof value !== 'object') return false;
  const a = value as Record<string, unknown>;
  return typeof a['id'] === 'string'
    && typeof a['name'] === 'string'
    && typeof a['command'] === 'string'
    && Array.isArray(a['args'])
    && a['args'].every(arg => typeof arg === 'string');
}

/** Parses the stored `codingAgents` JSON, returning null if it's corrupted or malformed. */
function parseStoredAgents(value: string): CodingAgent[] | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(value);
  } catch {
    return null;
  }
  return Array.isArray(parsed) && parsed.every(isCodingAgent) ? parsed : null;
}

/**
 * Reads the coding-agent roster from the config DB, seeding the built-in
 * presets on first read (when neither key has been saved before), and also
 * re-seeding (and persisting the fix) if the stored value is missing,
 * corrupted, or doesn't match the expected shape — e.g. from a manual edit,
 * a partial write, or an older/incompatible version of this app.
 */
export function getAgentRoster(db: ConfigDb): AgentRoster {
  const agentsRow = db.select().from(settings).where(eq(settings.key, AGENTS_KEY)).get();
  const defaultIdRow = db.select().from(settings).where(eq(settings.key, DEFAULT_AGENT_ID_KEY)).get();

  const agents = agentsRow ? parseStoredAgents(agentsRow.value) : null;
  if (!agents) {
    const seeded = defaultRoster();
    saveAgentRoster(db, seeded);
    return seeded;
  }

  const defaultAgentId = defaultIdRow?.value ?? null;
  return { agents, defaultAgentId };
}

/** Persists the full agent roster (agent list + default selection). */
export function saveAgentRoster(db: ConfigDb, roster: AgentRoster): void {
  db
    .insert(settings)
    .values({ key: AGENTS_KEY, value: JSON.stringify(roster.agents) })
    .onConflictDoUpdate({ target: settings.key, set: { value: JSON.stringify(roster.agents) } })
    .run();

  if (roster.defaultAgentId === null) {
    db.delete(settings).where(eq(settings.key, DEFAULT_AGENT_ID_KEY)).run();
  } else {
    db
      .insert(settings)
      .values({ key: DEFAULT_AGENT_ID_KEY, value: roster.defaultAgentId })
      .onConflictDoUpdate({ target: settings.key, set: { value: roster.defaultAgentId } })
      .run();
  }
}
