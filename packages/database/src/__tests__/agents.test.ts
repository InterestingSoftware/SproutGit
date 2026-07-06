import { tmpdir } from 'node:os';
import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { eq } from 'drizzle-orm';
import { openConfigDb } from '../config-db.js';
import { getAgentRoster, saveAgentRoster, resolveRosterAgent, getDefaultAgentConfig, getDefaultAgentRoster } from '../agents.js';
import { settings } from '../schema/config.js';

describe('agent roster', () => {
  let tmpDir: string;
  let db: ReturnType<typeof openConfigDb>;

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), 'sg-test-agents-'));
    db = openConfigDb(join(tmpDir, 'config.db'));
  });

  afterEach(() => {
    db.close();
    rmSync(tmpDir, { recursive: true, force: true });
  });

  it('seeds the default roster (Claude Code) when there is no roster and no legacy config', () => {
    const roster = getAgentRoster(db);
    expect(roster).toEqual(getDefaultAgentRoster());
  });

  it('persists the seeded roster so a second read does not re-seed over user edits', () => {
    getAgentRoster(db);

    const edited = {
      agents: [{ id: 'a1', name: 'Codex', command: 'codex', args: ['exec'], env: {}, mode: 'terminal' as const, acp: false }],
      defaultAgentId: 'a1',
    };
    saveAgentRoster(db, edited);

    const roster = getAgentRoster(db);
    expect(roster).toEqual(edited);
  });

  it('round-trips a multi-agent roster with per-agent env vars', () => {
    const roster = {
      agents: [
        { id: 'a1', name: 'Claude Code', command: 'claude', args: [], env: {}, mode: 'integrated' as const, acp: true },
        { id: 'a2', name: 'My Proxy Agent', command: 'my-agent-cli', args: ['--flag'], env: { OPENAI_BASE_URL: 'https://proxy.internal' }, mode: 'integrated' as const, acp: true },
      ],
      defaultAgentId: 'a2',
    };
    saveAgentRoster(db, roster);

    expect(getAgentRoster(db)).toEqual(roster);
  });

  it('migrates a legacy single-agent config into a one-entry roster on first read', () => {
    db.insert(settings).values({
      key: 'agentConfig',
      value: JSON.stringify(getDefaultAgentConfig()),
    }).run();

    const roster = getAgentRoster(db);
    expect(roster.agents).toHaveLength(1);
    expect(roster.agents[0]).toMatchObject({ command: 'claude', args: [], mode: 'integrated', acp: true });
    expect(roster.defaultAgentId).toBe(roster.agents[0]!.id);

    // The migration is persisted under the new key, not just returned in-memory.
    const row = db.select().from(settings).where(eq(settings.key, 'agentRoster')).get();
    expect(row).toBeTruthy();
    expect(JSON.parse(row!.value)).toEqual(roster);
  });

  it('migrates a legacy custom (non-ACP-recognized) command with acp: false', () => {
    db.insert(settings).values({
      key: 'agentConfig',
      value: JSON.stringify({ command: 'my-custom-cli', args: ['--flag'], mode: 'terminal' }),
    }).run();

    const roster = getAgentRoster(db);
    expect(roster.agents[0]).toMatchObject({ command: 'my-custom-cli', args: ['--flag'], mode: 'terminal', acp: false });
  });

  it('prefers a valid roster over a legacy config if both are present', () => {
    db.insert(settings).values({ key: 'agentConfig', value: JSON.stringify(getDefaultAgentConfig()) }).run();
    const roster = { agents: [{ id: 'x', name: 'X', command: 'x', args: [], env: {}, mode: 'terminal' as const, acp: false }], defaultAgentId: 'x' };
    saveAgentRoster(db, roster);

    expect(getAgentRoster(db)).toEqual(roster);
  });

  it('re-seeds and persists the fix when the stored roster is invalid JSON', () => {
    db.insert(settings).values({ key: 'agentRoster', value: 'not json{' }).run();

    const roster = getAgentRoster(db);
    expect(roster).toEqual(getDefaultAgentRoster());

    const row = db.select().from(settings).where(eq(settings.key, 'agentRoster')).get();
    expect(row?.value ? JSON.parse(row.value) : null).toEqual(getDefaultAgentRoster());
  });

  it('re-seeds when the stored roster is valid JSON but the wrong shape', () => {
    db.insert(settings).values({ key: 'agentRoster', value: JSON.stringify({ foo: 'bad' }) }).run();

    const roster = getAgentRoster(db);
    expect(roster).toEqual(getDefaultAgentRoster());
  });

  it('re-seeds when defaultAgentId does not reference any agent in the list', () => {
    db.insert(settings).values({
      key: 'agentRoster',
      value: JSON.stringify({
        agents: [{ id: 'a1', name: 'A', command: 'a', args: [], env: {}, mode: 'terminal', acp: false }],
        defaultAgentId: 'does-not-exist',
      }),
    }).run();

    const roster = getAgentRoster(db);
    expect(roster).toEqual(getDefaultAgentRoster());
  });

  it('rejects saving an empty roster', () => {
    expect(() => saveAgentRoster(db, { agents: [], defaultAgentId: '' })).toThrow();
  });

  it('rejects saving a roster whose defaultAgentId does not match any agent', () => {
    const bad = { agents: [{ id: 'a1', name: 'A', command: 'a', args: [], env: {}, mode: 'terminal' as const, acp: false }], defaultAgentId: 'nope' };
    expect(() => saveAgentRoster(db, bad)).toThrow();
  });
});

describe('resolveRosterAgent', () => {
  const roster = {
    agents: [
      { id: 'a1', name: 'A', command: 'a', args: [], env: {}, mode: 'terminal' as const, acp: false },
      { id: 'a2', name: 'B', command: 'b', args: [], env: {}, mode: 'terminal' as const, acp: false },
    ],
    defaultAgentId: 'a2',
  };

  it('returns the requested agent by id', () => {
    expect(resolveRosterAgent(roster, 'a1')).toEqual(roster.agents[0]);
  });

  it('falls back to the default agent when no id is given', () => {
    expect(resolveRosterAgent(roster)).toEqual(roster.agents[1]);
  });

  it('falls back to the default agent when the requested id is not found', () => {
    expect(resolveRosterAgent(roster, 'does-not-exist')).toEqual(roster.agents[1]);
  });
});
