import { tmpdir } from 'node:os';
import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { eq } from 'drizzle-orm';
import { openConfigDb } from '../config-db.js';
import { getAgentConfig, saveAgentConfig, getDefaultAgentConfig } from '../agents.js';
import { settings } from '../schema/config.js';

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

  it('seeds the default agent config on first read', () => {
    const config = getAgentConfig(db);
    expect(config).toEqual(getDefaultAgentConfig());
  });

  it('persists the seeded config so a second read does not re-seed over user edits', () => {
    getAgentConfig(db);

    const edited = { command: 'codex', args: ['exec'], mode: 'terminal' as const };
    saveAgentConfig(db, edited);

    const config = getAgentConfig(db);
    expect(config).toEqual(edited);
  });

  it('round-trips a custom agent config', () => {
    const custom = { command: 'my-agent-cli', args: ['--flag'], mode: 'terminal' as const };
    saveAgentConfig(db, custom);

    const config = getAgentConfig(db);
    expect(config).toEqual(custom);
  });

  it('re-seeds and persists the fix when the stored value is invalid JSON', () => {
    db.insert(settings).values({ key: 'agentConfig', value: 'not json{' }).run();

    const config = getAgentConfig(db);
    expect(config).toEqual(getDefaultAgentConfig());

    // The recovery should have been persisted, not just returned in-memory.
    const row = db.select().from(settings).where(eq(settings.key, 'agentConfig')).get();
    expect(row?.value ? JSON.parse(row.value) : null).toEqual(getDefaultAgentConfig());
  });

  it('re-seeds when the stored value is valid JSON but the wrong shape', () => {
    db.insert(settings).values({ key: 'agentConfig', value: JSON.stringify({ foo: 'bad' }) }).run();

    const config = getAgentConfig(db);
    expect(config).toEqual(getDefaultAgentConfig());
  });

  it('re-seeds when the stored mode is not a recognized value', () => {
    db.insert(settings).values({
      key: 'agentConfig',
      value: JSON.stringify({ command: 'claude', args: [], mode: 'bogus' }),
    }).run();

    const config = getAgentConfig(db);
    expect(config).toEqual(getDefaultAgentConfig());
  });
});
