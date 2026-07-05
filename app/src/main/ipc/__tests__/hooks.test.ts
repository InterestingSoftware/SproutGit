import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

vi.mock('electron', () => ({ ipcMain: { handle: vi.fn() } }));
vi.mock('../../telemetry.js', () => ({ log: { error: vi.fn(), info: vi.fn(), warn: vi.fn() } }));

import { openConfigDb, openWorkspaceDb, type ConfigDb } from '@sproutgit/database';
import { hookDefinitions, hookDependencies } from '@sproutgit/database/schema/workspace';
import { getEffectiveHooks } from '../hooks.js';
import { writeLocalHooksFile, localHooksFilePath, repoHooksFilePath, hashHookDefinition, readHooksFile } from '../../hooks-file.js';
import { trustHook } from '../../hooks-trust.js';
import type { HookFileDefinition } from '@sproutgit/types';

function workspaceDbPath(workspacePath: string): string {
  return join(workspacePath, '.sproutgit', 'state.db');
}

const LOCAL_HOOK: HookFileDefinition = {
  name: 'Install deps', scope: 'worktree', trigger: 'after_worktree_create', executionTarget: 'trigger_worktree',
  shell: 'bash', script: 'pnpm install', enabled: true, critical: false, switchOncePerSession: false,
  switchRunOnCreate: true, switchRunOnDelete: false, keepOpenOnCompletion: false, timeoutSeconds: 60, dependsOn: [],
};

describe('getEffectiveHooks', () => {
  let workspacePath: string;
  let configDb: ConfigDb;

  beforeEach(() => {
    workspacePath = mkdtempSync(join(tmpdir(), 'sg-hooks-ipc-test-'));
    configDb = openConfigDb(join(workspacePath, 'config.db'));
  });

  afterEach(() => {
    configDb.close();
    rmSync(workspacePath, { recursive: true, force: true });
  });

  it('returns local hooks (always trusted) with no worktree given', () => {
    writeLocalHooksFile(workspacePath, [LOCAL_HOOK]);

    const result = getEffectiveHooks(workspacePath, null, configDb);
    expect(result.repoFileError).toBeNull();
    expect(result.hooks).toEqual([
      expect.objectContaining({ id: 'local:Install deps', source: 'local', trusted: true, enabled: true }),
    ]);
  });

  it('migrates legacy workspace-DB hooks into local-hooks.json on first read', () => {
    const db = openWorkspaceDb(workspaceDbPath(workspacePath));
    const now = new Date();
    db.insert(hookDefinitions).values({
      id: 'legacy-uuid-1', name: 'Legacy Hook', scope: 'worktree', trigger: 'manual',
      executionTarget: 'trigger_worktree', shell: 'bash', script: 'echo legacy',
      enabled: true, critical: false, switchOncePerSession: false, switchRunOnCreate: true,
      switchRunOnDelete: false, keepOpenOnCompletion: false, timeoutSeconds: 300,
      createdAt: now, updatedAt: now,
    }).run();
    db.close();

    expect(existsSync(localHooksFilePath(workspacePath))).toBe(false);

    const result = getEffectiveHooks(workspacePath, null, configDb);
    expect(result.hooks).toEqual([
      expect.objectContaining({ id: 'local:Legacy Hook', name: 'Legacy Hook', source: 'local', trusted: true }),
    ]);
    expect(existsSync(localHooksFilePath(workspacePath))).toBe(true);
  });

  it('migration converts dependsOn from legacy dependency-table ids to names', () => {
    const db = openWorkspaceDb(workspaceDbPath(workspacePath));
    const now = new Date();
    db.insert(hookDefinitions).values([
      { id: 'a-id', name: 'a', scope: 'worktree', trigger: 'manual', executionTarget: 'trigger_worktree', shell: 'bash', script: 'echo a', enabled: true, critical: false, switchOncePerSession: false, switchRunOnCreate: true, switchRunOnDelete: false, keepOpenOnCompletion: false, timeoutSeconds: 300, createdAt: now, updatedAt: now },
      { id: 'b-id', name: 'b', scope: 'worktree', trigger: 'manual', executionTarget: 'trigger_worktree', shell: 'bash', script: 'echo b', enabled: true, critical: false, switchOncePerSession: false, switchRunOnCreate: true, switchRunOnDelete: false, keepOpenOnCompletion: false, timeoutSeconds: 300, createdAt: now, updatedAt: now },
    ]).run();
    db.insert(hookDependencies).values({ hookId: 'b-id', dependsOnId: 'a-id' }).run();
    db.close();

    const result = getEffectiveHooks(workspacePath, null, configDb);
    const b = result.hooks.find(h => h.name === 'b');
    expect(b?.dependsOn).toEqual(['a']);
  });

  it('once migrated, later reads no longer depend on the legacy DB rows', () => {
    const db = openWorkspaceDb(workspaceDbPath(workspacePath));
    const now = new Date();
    db.insert(hookDefinitions).values({
      id: 'legacy-uuid-2', name: 'Legacy Hook 2', scope: 'worktree', trigger: 'manual',
      executionTarget: 'trigger_worktree', shell: 'bash', script: 'echo legacy2',
      enabled: true, critical: false, switchOncePerSession: false, switchRunOnCreate: true,
      switchRunOnDelete: false, keepOpenOnCompletion: false, timeoutSeconds: 300,
      createdAt: now, updatedAt: now,
    }).run();

    getEffectiveHooks(workspacePath, null, configDb); // triggers migration

    // Wipe the legacy rows entirely — the migrated file should be unaffected.
    db.delete(hookDefinitions).run();
    db.close();

    const result = getEffectiveHooks(workspacePath, null, configDb);
    expect(result.hooks.some(h => h.name === 'Legacy Hook 2')).toBe(true);
  });

  it('includes untrusted repo hooks with trusted: false', () => {
    const worktreePath = mkdtempSync(join(tmpdir(), 'sg-hooks-ipc-worktree-'));
    try {
      writeFileSync(repoHooksFilePath(worktreePath), JSON.stringify({
        version: 1,
        hooks: [{ name: 'Repo hook', trigger: 'manual', executionTarget: 'trigger_worktree', shell: 'bash', script: 'echo repo' }],
      }));

      const result = getEffectiveHooks(workspacePath, worktreePath, configDb);
      expect(result.repoFileError).toBeNull();
      expect(result.hooks).toEqual([
        expect.objectContaining({ id: 'repo:Repo hook', source: 'repo', trusted: false }),
      ]);
    } finally {
      rmSync(worktreePath, { recursive: true, force: true });
    }
  });

  it('reports trusted: true for a repo hook once its exact content is trusted', () => {
    const worktreePath = mkdtempSync(join(tmpdir(), 'sg-hooks-ipc-worktree-'));
    try {
      writeFileSync(repoHooksFilePath(worktreePath), JSON.stringify({
        version: 1,
        hooks: [{ name: 'Repo hook', trigger: 'manual', executionTarget: 'trigger_worktree', shell: 'bash', script: 'echo repo' }],
      }));

      const { hooks: repoDefs } = readHooksFile(repoHooksFilePath(worktreePath));
      trustHook(configDb, worktreePath, hashHookDefinition(repoDefs[0]!));

      const result = getEffectiveHooks(workspacePath, worktreePath, configDb);
      expect(result.hooks[0]?.trusted).toBe(true);
    } finally {
      rmSync(worktreePath, { recursive: true, force: true });
    }
  });

  it('surfaces a parse error for a malformed repo file without throwing', () => {
    const worktreePath = mkdtempSync(join(tmpdir(), 'sg-hooks-ipc-worktree-'));
    try {
      writeFileSync(repoHooksFilePath(worktreePath), '{ not json');
      const result = getEffectiveHooks(workspacePath, worktreePath, configDb);
      expect(result.repoFileError).toBeTruthy();
      expect(result.hooks).toEqual([]);
    } finally {
      rmSync(worktreePath, { recursive: true, force: true });
    }
  });

  it('omits repo hooks entirely (and reports no error) when worktreePath is null', () => {
    const result = getEffectiveHooks(workspacePath, null, configDb);
    expect(result.repoFileError).toBeNull();
    expect(result.hooks).toEqual([]);
  });
});
