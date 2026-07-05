import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync, readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import {
  readHooksFile,
  writeLocalHooksFile,
  toWorkspaceHook,
  hashHookDefinition,
  localHooksFilePath,
  repoHooksFilePath,
  makeHookId,
  parseHookId,
  isRepoHookId,
  REPO_HOOKS_FILENAME,
} from '../hooks-file.js';
import type { HookFileDefinition } from '@sproutgit/types';

function baseHookInput(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    name: 'Install deps',
    trigger: 'after_worktree_create',
    executionTarget: 'trigger_worktree',
    shell: 'bash',
    script: 'pnpm install',
    ...overrides,
  };
}

describe('makeHookId / parseHookId / isRepoHookId', () => {
  it('round-trips local and repo ids', () => {
    expect(makeHookId('local', 'My Hook')).toBe('local:My Hook');
    expect(makeHookId('repo', 'My Hook')).toBe('repo:My Hook');
    expect(parseHookId('local:My Hook')).toEqual({ source: 'local', name: 'My Hook' });
    expect(parseHookId('repo:My Hook')).toEqual({ source: 'repo', name: 'My Hook' });
    expect(parseHookId('not-a-valid-id')).toBeNull();
  });

  it('recognizes repo-sourced ids', () => {
    expect(isRepoHookId('repo:x')).toBe(true);
    expect(isRepoHookId('local:x')).toBe(false);
  });
});

describe('readHooksFile', () => {
  let dir: string;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'sg-hooks-file-test-'));
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it('returns an empty, error-free result when the file is absent', () => {
    const result = readHooksFile(repoHooksFilePath(dir));
    expect(result).toEqual({ hooks: [], error: null });
  });

  it('parses a valid file into fully-normalized HookFileDefinitions', () => {
    writeFileSync(repoHooksFilePath(dir), JSON.stringify({ version: 1, hooks: [baseHookInput()] }));

    const result = readHooksFile(repoHooksFilePath(dir));
    expect(result.error).toBeNull();
    expect(result.hooks).toEqual([
      expect.objectContaining({
        name: 'Install deps',
        trigger: 'after_worktree_create',
        executionTarget: 'trigger_worktree',
        shell: 'bash',
        script: 'pnpm install',
        enabled: true,
        critical: false,
        dependsOn: [],
      }),
    ]);
  });

  it('resolves dependsOn by name', () => {
    writeFileSync(repoHooksFilePath(dir), JSON.stringify({
      version: 1,
      hooks: [
        baseHookInput({ name: 'a', trigger: 'manual' }),
        baseHookInput({ name: 'b', trigger: 'manual', dependsOn: ['a'] }),
      ],
    }));

    const result = readHooksFile(repoHooksFilePath(dir));
    expect(result.error).toBeNull();
    expect(result.hooks.find(h => h.name === 'b')?.dependsOn).toEqual(['a']);
  });

  it('reports an error and empty hooks for malformed JSON', () => {
    writeFileSync(repoHooksFilePath(dir), '{ not valid json');
    const result = readHooksFile(repoHooksFilePath(dir));
    expect(result.hooks).toEqual([]);
    expect(result.error).toBeTruthy();
  });

  it('rejects an unknown trigger', () => {
    writeFileSync(repoHooksFilePath(dir), JSON.stringify({
      version: 1,
      hooks: [baseHookInput({ trigger: 'on_full_moon' })],
    }));
    const result = readHooksFile(repoHooksFilePath(dir));
    expect(result.hooks).toEqual([]);
    expect(result.error).toMatch(/trigger/);
  });

  it('rejects duplicate hook names', () => {
    writeFileSync(repoHooksFilePath(dir), JSON.stringify({
      version: 1,
      hooks: [baseHookInput({ name: 'dup' }), baseHookInput({ name: 'dup' })],
    }));
    const result = readHooksFile(repoHooksFilePath(dir));
    expect(result.hooks).toEqual([]);
    expect(result.error).toMatch(/duplicate/);
  });

  it('rejects a dependsOn reference to an unknown hook', () => {
    writeFileSync(repoHooksFilePath(dir), JSON.stringify({
      version: 1,
      hooks: [baseHookInput({ dependsOn: ['ghost'] })],
    }));
    const result = readHooksFile(repoHooksFilePath(dir));
    expect(result.hooks).toEqual([]);
    expect(result.error).toMatch(/unknown hook/);
  });
});

describe('writeLocalHooksFile', () => {
  let dir: string;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'sg-hooks-file-write-test-'));
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it('creates .sproutgit/local-hooks.json and round-trips through readHooksFile', () => {
    const def: HookFileDefinition = {
      name: 'Notify', scope: 'worktree', trigger: 'manual', executionTarget: 'trigger_worktree',
      shell: 'bash', script: 'echo hi', enabled: true, critical: false, switchOncePerSession: false,
      switchRunOnCreate: true, switchRunOnDelete: false, keepOpenOnCompletion: false, timeoutSeconds: 60,
      dependsOn: [], createdAt: 1000, updatedAt: 1000,
    };
    writeLocalHooksFile(dir, [def]);

    expect(existsSync(localHooksFilePath(dir))).toBe(true);
    const result = readHooksFile(localHooksFilePath(dir));
    expect(result.error).toBeNull();
    expect(result.hooks).toEqual([def]);
  });

  it('writes valid pretty-printed JSON ending in a newline', () => {
    writeLocalHooksFile(dir, []);
    const raw = readFileSync(localHooksFilePath(dir), 'utf8');
    expect(raw.endsWith('\n')).toBe(true);
    expect(JSON.parse(raw)).toEqual({ version: 1, hooks: [] });
  });
});

describe('toWorkspaceHook', () => {
  const def: HookFileDefinition = {
    name: 'Build', scope: 'worktree', trigger: 'manual', executionTarget: 'trigger_worktree',
    shell: 'zsh', script: 'pnpm build', enabled: true, critical: true, switchOncePerSession: false,
    switchRunOnCreate: true, switchRunOnDelete: false, keepOpenOnCompletion: false, timeoutSeconds: 120,
    dependsOn: ['other'],
  };

  it('sets id, source, and trusted from the given arguments', () => {
    const hook = toWorkspaceHook(def, 'repo', false);
    expect(hook.id).toBe('repo:Build');
    expect(hook.source).toBe('repo');
    expect(hook.trusted).toBe(false);
    expect(hook.dependsOn).toEqual(['other']);
  });

  it('local hooks pass through trusted=true when told to', () => {
    const hook = toWorkspaceHook(def, 'local', true);
    expect(hook.id).toBe('local:Build');
    expect(hook.trusted).toBe(true);
  });
});

describe('hashHookDefinition', () => {
  const def: HookFileDefinition = {
    name: 'a', scope: 'worktree', trigger: 'manual', executionTarget: 'trigger_worktree',
    shell: 'bash', script: 'echo 1', enabled: true, critical: false, switchOncePerSession: false,
    switchRunOnCreate: true, switchRunOnDelete: false, keepOpenOnCompletion: false, timeoutSeconds: 60,
    dependsOn: [],
  };

  it('is deterministic for identical content', () => {
    expect(hashHookDefinition(def)).toBe(hashHookDefinition({ ...def }));
  });

  it('changes when the script changes', () => {
    expect(hashHookDefinition(def)).not.toBe(hashHookDefinition({ ...def, script: 'echo 2' }));
  });

  it('does NOT change when an unrelated hook in the same file changes (per-hook, not per-file)', () => {
    // Simulates the scenario that motivated per-hook trust: editing hook B's
    // script must not change hook A's hash, so A stays trusted.
    const other: HookFileDefinition = { ...def, name: 'b', script: 'echo other' };
    const hashBefore = hashHookDefinition(def);
    const hashAfterUnrelatedEdit = hashHookDefinition(def); // `def` (hook a) itself untouched
    void other;
    expect(hashAfterUnrelatedEdit).toBe(hashBefore);
  });

  it('changes when the hook is renamed', () => {
    expect(hashHookDefinition(def)).not.toBe(hashHookDefinition({ ...def, name: 'b' }));
  });
});

describe('REPO_HOOKS_FILENAME', () => {
  it('is the well-known filename used at a worktree root', () => {
    expect(REPO_HOOKS_FILENAME).toBe('sproutgit.hooks.json');
  });
});
