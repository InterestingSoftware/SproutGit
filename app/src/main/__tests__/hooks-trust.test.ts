import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { openConfigDb, type ConfigDb } from '@sproutgit/database';
import { isHookTrusted, trustHook } from '../hooks-trust.js';

describe('hooks-trust (per-hook)', () => {
  let dir: string;
  let configDb: ConfigDb;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'sg-hooks-trust-test-'));
    configDb = openConfigDb(join(dir, 'config.db'));
  });

  afterEach(() => {
    configDb.close();
    rmSync(dir, { recursive: true, force: true });
  });

  it('reports untrusted for a hash never seen before', () => {
    expect(isHookTrusted(configDb, '/some/worktree', 'hash-a')).toBe(false);
  });

  it('reports trusted after trustHook is called for that exact hash', () => {
    trustHook(configDb, '/some/worktree', 'hash-a');
    expect(isHookTrusted(configDb, '/some/worktree', 'hash-a')).toBe(true);
  });

  it('trusting one hook does not trust a different hook in the same file', () => {
    trustHook(configDb, '/some/worktree', 'hash-a');
    expect(isHookTrusted(configDb, '/some/worktree', 'hash-b')).toBe(false);
  });

  it('editing a trusted hook (new hash) requires re-trusting just that hook', () => {
    trustHook(configDb, '/some/worktree', 'hash-a-v1');
    expect(isHookTrusted(configDb, '/some/worktree', 'hash-a-v1')).toBe(true);
    expect(isHookTrusted(configDb, '/some/worktree', 'hash-a-v2')).toBe(false);
  });

  it('remembers multiple previously-trusted hook hashes for the same worktree', () => {
    trustHook(configDb, '/some/worktree', 'hash-a');
    trustHook(configDb, '/some/worktree', 'hash-b');
    trustHook(configDb, '/some/worktree', 'hash-c');
    expect(isHookTrusted(configDb, '/some/worktree', 'hash-a')).toBe(true);
    expect(isHookTrusted(configDb, '/some/worktree', 'hash-b')).toBe(true);
    expect(isHookTrusted(configDb, '/some/worktree', 'hash-c')).toBe(true);
  });

  it('scopes trust per worktree path — trusting one worktree does not trust another', () => {
    trustHook(configDb, '/worktree/a', 'shared-hash');
    expect(isHookTrusted(configDb, '/worktree/b', 'shared-hash')).toBe(false);
  });

  it('is idempotent — trusting the same hash twice does not duplicate it', () => {
    trustHook(configDb, '/some/worktree', 'hash-a');
    trustHook(configDb, '/some/worktree', 'hash-a');
    expect(isHookTrusted(configDb, '/some/worktree', 'hash-a')).toBe(true);
  });
});
