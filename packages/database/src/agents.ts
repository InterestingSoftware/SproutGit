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

/**
 * Reads the coding-agent roster from the config DB, seeding the built-in
 * presets on first read (when neither key has been saved before).
 */
export function getAgentRoster(db: ConfigDb): AgentRoster {
  const agentsRow = db.select().from(settings).where(eq(settings.key, AGENTS_KEY)).get();
  const defaultIdRow = db.select().from(settings).where(eq(settings.key, DEFAULT_AGENT_ID_KEY)).get();

  if (!agentsRow) {
    const seeded = defaultRoster();
    saveAgentRoster(db, seeded);
    return seeded;
  }

  const agents = JSON.parse(agentsRow.value) as CodingAgent[];
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
