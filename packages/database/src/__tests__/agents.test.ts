import { tmpdir } from 'node:os';
import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { openConfigDb } from '../config-db.js';
import { getAgentRoster, saveAgentRoster, getDefaultAgentPresets } from '../agents.js';

describe('agents', () => {
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

  it('seeds the built-in presets on first read', () => {
    const roster = getAgentRoster(db);
    expect(roster.agents).toEqual(getDefaultAgentPresets());
    expect(roster.defaultAgentId).toBe('claude-code');
  });

  it('persists the seeded presets so a second read does not re-seed over user edits', () => {
    getAgentRoster(db);

    const edited = {
      agents: getDefaultAgentPresets().filter(a => a.id !== 'kiro'),
      defaultAgentId: 'codex',
    };
    saveAgentRoster(db, edited);

    const roster = getAgentRoster(db);
    expect(roster.agents.some(a => a.id === 'kiro')).toBe(false);
    expect(roster.defaultAgentId).toBe('codex');
  });

  it('round-trips a custom agent roster', () => {
    const custom = {
      agents: [{ id: 'my-agent', name: 'My Agent', command: 'my-agent-cli', args: ['--flag'] }],
      defaultAgentId: 'my-agent',
    };
    saveAgentRoster(db, custom);

    const roster = getAgentRoster(db);
    expect(roster).toEqual(custom);
  });

  it('clears the default agent id when set to null', () => {
    saveAgentRoster(db, { agents: getDefaultAgentPresets(), defaultAgentId: 'claude-code' });
    saveAgentRoster(db, { agents: getDefaultAgentPresets(), defaultAgentId: null });

    const roster = getAgentRoster(db);
    expect(roster.defaultAgentId).toBeNull();
  });
});
