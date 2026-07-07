import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

vi.mock('electron', () => ({ ipcMain: { handle: vi.fn() } }));
vi.mock('../../telemetry.js', () => ({ log: { error: vi.fn(), info: vi.fn(), warn: vi.fn() } }));

import { openConfigDb, openWorkspaceDb, type ConfigDb } from '@sproutgit/database';
import { hookDefinitions, hookDependencies } from '@sproutgit/database/schema/workspace';
import {
  getEffectiveHooks,
  createLocalHook,
  updateLocalHook,
  deleteLocalHook,
  toggleLocalHook,
  runHookForMcp,
} from '../hooks.js';
import { writeLocalHooksFile, localHooksFilePath, repoHooksFilePath, hashHookDefinition, readHooksFile } from '../../hooks-file.js';
import { trustHook, isHookTrusted } from '../../hooks-trust.js';
import type { HookFileDefinition } from '@sproutgit/types';
import type { BrowserWindow } from 'electron';

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

/** Matches the shape createLocalHook/updateLocalHook expect — a fresh object per call since dependsOn/name get mutated by individual tests. */
function localHookInput(overrides: { workspacePath: string } & Partial<Parameters<typeof createLocalHook>[0]>): Parameters<typeof createLocalHook>[0] {
  return {
    name: 'Install deps', scope: 'worktree', trigger: 'after_worktree_create',
    executionTarget: 'trigger_worktree', shell: 'bash', script: 'pnpm install',
    enabled: true, critical: false, switchOncePerSession: false, switchRunOnCreate: true,
    switchRunOnDelete: false, keepOpenOnCompletion: false, timeoutSeconds: 60, dependsOn: [],
    ...overrides,
  };
}

describe('local hook CRUD — reused as-is by the MCP write tools (see mcp-bridge.ts)', () => {
  let workspacePath: string;

  beforeEach(() => {
    workspacePath = mkdtempSync(join(tmpdir(), 'sg-hooks-crud-test-'));
  });

  afterEach(() => {
    rmSync(workspacePath, { recursive: true, force: true });
  });

  it('createLocalHook adds a hook to local-hooks.json', () => {
    createLocalHook(localHookInput({ workspacePath }));
    const { hooks } = readHooksFile(localHooksFilePath(workspacePath));
    expect(hooks).toHaveLength(1);
    expect(hooks[0]?.name).toBe('Install deps');
  });

  it('createLocalHook rejects a duplicate local hook name', () => {
    createLocalHook(localHookInput({ workspacePath }));
    expect(() => createLocalHook(localHookInput({ workspacePath }))).toThrow(/already exists/);
  });

  it('createLocalHook rejects a dependsOn referencing an unknown hook', () => {
    expect(() => createLocalHook(localHookInput({ workspacePath, dependsOn: ['does-not-exist'] })))
      .toThrow(/unknown local hook/);
    // The rejected hook must never have been written — otherwise it would
    // corrupt local-hooks.json and disable every local hook on next read.
    const { hooks } = readHooksFile(localHooksFilePath(workspacePath));
    expect(hooks).toHaveLength(0);
  });

  it('createLocalHook rejects a hook that depends on itself', () => {
    expect(() => createLocalHook(localHookInput({ workspacePath, name: 'a', dependsOn: ['a'] })))
      .toThrow(/cannot depend on itself/);
  });

  it('updateLocalHook renames a hook and cascades the rename into other hooks\' dependsOn', () => {
    createLocalHook(localHookInput({ workspacePath, name: 'a' }));
    createLocalHook(localHookInput({ workspacePath, name: 'b', dependsOn: ['a'] }));
    updateLocalHook({ workspacePath, id: 'local:a', name: 'a-renamed' });
    const { hooks } = readHooksFile(localHooksFilePath(workspacePath));
    expect(hooks.find(h => h.name === 'b')?.dependsOn).toEqual(['a-renamed']);
  });

  it('updateLocalHook rejects a dependsOn referencing an unknown hook, leaving the file untouched', () => {
    createLocalHook(localHookInput({ workspacePath, name: 'a' }));
    expect(() => updateLocalHook({ workspacePath, id: 'local:a', dependsOn: ['does-not-exist'] }))
      .toThrow(/unknown local hook/);
    const { hooks } = readHooksFile(localHooksFilePath(workspacePath));
    expect(hooks.find(h => h.name === 'a')?.dependsOn).toEqual([]);
  });

  it('updateLocalHook rejects a rename that would make dependsOn reference itself', () => {
    createLocalHook(localHookInput({ workspacePath, name: 'a', dependsOn: [] }));
    createLocalHook(localHookInput({ workspacePath, name: 'b', dependsOn: ['a'] }));
    // Renaming "a" to "b" while "b" already depends on the name "a" would
    // leave "b" depending on itself post-rename.
    expect(() => updateLocalHook({ workspacePath, id: 'local:b', dependsOn: ['b'] }))
      .toThrow(/cannot depend on itself/);
  });

  it('updateLocalHook is a no-op for a repo hook id — repo hooks stay read-only', () => {
    createLocalHook(localHookInput({ workspacePath }));
    updateLocalHook({ workspacePath, id: 'repo:Install deps', enabled: false });
    const { hooks } = readHooksFile(localHooksFilePath(workspacePath));
    expect(hooks[0]?.enabled).toBe(true);
  });

  it('deleteLocalHook removes the hook and clears dangling dependsOn references', () => {
    createLocalHook(localHookInput({ workspacePath, name: 'a' }));
    createLocalHook(localHookInput({ workspacePath, name: 'b', dependsOn: ['a'] }));
    deleteLocalHook({ workspacePath, id: 'local:a' });
    const { hooks } = readHooksFile(localHooksFilePath(workspacePath));
    expect(hooks.map(h => h.name)).toEqual(['b']);
    expect(hooks[0]?.dependsOn).toEqual([]);
  });

  it('deleteLocalHook is a no-op for a repo hook id', () => {
    createLocalHook(localHookInput({ workspacePath }));
    deleteLocalHook({ workspacePath, id: 'repo:Install deps' });
    const { hooks } = readHooksFile(localHooksFilePath(workspacePath));
    expect(hooks).toHaveLength(1);
  });

  it('toggleLocalHook flips enabled for a local hook', () => {
    createLocalHook(localHookInput({ workspacePath }));
    toggleLocalHook({ workspacePath, id: 'local:Install deps', enabled: false });
    const { hooks } = readHooksFile(localHooksFilePath(workspacePath));
    expect(hooks[0]?.enabled).toBe(false);
  });
});

describe('runHookForMcp — the run_hook tool boundary (no trust granting, no bypass)', () => {
  let workspacePath: string;
  let worktreePath: string;
  let configDb: ConfigDb;
  const fakeWin = { webContents: { send: () => { /* no-op */ } } } as unknown as BrowserWindow;

  beforeEach(() => {
    workspacePath = mkdtempSync(join(tmpdir(), 'sg-hooks-run-test-'));
    worktreePath = mkdtempSync(join(tmpdir(), 'sg-hooks-run-worktree-'));
    configDb = openConfigDb(join(workspacePath, 'config.db'));
  });

  afterEach(() => {
    configDb.close();
    rmSync(workspacePath, { recursive: true, force: true });
    rmSync(worktreePath, { recursive: true, force: true });
  });

  it('refuses to run an untrusted repo hook, and grants it no trust as a side effect', async () => {
    writeFileSync(repoHooksFilePath(worktreePath), JSON.stringify({
      version: 1,
      hooks: [{ name: 'Repo hook', trigger: 'manual', executionTarget: 'trigger_worktree', shell: 'bash', script: 'echo pwned' }],
    }));
    const { hooks: repoDefs } = readHooksFile(repoHooksFilePath(worktreePath));
    const hash = hashHookDefinition(repoDefs[0]!);
    expect(isHookTrusted(configDb, worktreePath, hash)).toBe(false);

    const result = await runHookForMcp({ workspacePath, hookId: 'repo:Repo hook', worktreePath }, fakeWin, configDb);

    expect(result.status).toBe('not_run');
    expect(result.errorMessage).toMatch(/untrusted/i);
    // The whole point of this test: calling run_hook must never have the
    // side effect of trusting the hook it refused to run.
    expect(isHookTrusted(configDb, worktreePath, hash)).toBe(false);
  });

  it('refuses to run a disabled local hook', async () => {
    createLocalHook(localHookInput({ workspacePath, name: 'Off hook', enabled: false, trigger: 'manual' }));
    const result = await runHookForMcp({ workspacePath, hookId: 'local:Off hook', worktreePath }, fakeWin, configDb);
    expect(result.status).toBe('not_run');
    expect(result.errorMessage).toMatch(/disabled/i);
  });

  it('reports not_run with a clear message for an unknown hookId', async () => {
    const result = await runHookForMcp({ workspacePath, hookId: 'local:does-not-exist', worktreePath }, fakeWin, configDb);
    expect(result.status).toBe('not_run');
    expect(result.errorMessage).toMatch(/no hook/i);
  });

  it('reports not_run when no workspace window is open, rather than throwing', async () => {
    createLocalHook(localHookInput({ workspacePath, name: 'Trusted hook', trigger: 'manual' }));
    const result = await runHookForMcp({ workspacePath, hookId: 'local:Trusted hook', worktreePath }, null, configDb);
    expect(result.status).toBe('not_run');
    expect(result.errorMessage).toMatch(/no open window/i);
  });
});
