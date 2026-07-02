import { tmpdir } from 'node:os';
import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { eq } from 'drizzle-orm';
import { openWorkspaceDb } from '../workspace-db.js';
import { hookDefinitions, worktreeMetadata } from '../schema/workspace.js';

describe('workspace-db', () => {
  let tmpDir: string;
  let dbPath: string;
  let db: ReturnType<typeof openWorkspaceDb>;

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), 'sg-test-workspace-'));
    dbPath = join(tmpDir, 'workspace.db');
    db = openWorkspaceDb(dbPath);
  });

  afterEach(() => {
    db.close();
    rmSync(tmpDir, { recursive: true, force: true });
  });

  it('opens and migrates without error', () => {
    expect(db).toBeDefined();
  });

  it('stores and retrieves worktree metadata', () => {
    const now = Date.now();
    db
      .insert(worktreeMetadata)
      .values({
        worktreePath: '/workspace/worktrees/feature-x',
        branch: 'feature-x',
        sourceRef: 'main',
        rootRepoPath: '/workspace/root',
        createdAt: new Date(now),
        updatedAt: new Date(now),
      })
      .run();

    const rows = db.select().from(worktreeMetadata).all();
    expect(rows).toHaveLength(1);
    expect(rows[0]?.branch).toBe('feature-x');
  });

  it('round-trips an optional issueRef/issueTitle on worktree metadata', () => {
    const now = Date.now();
    db
      .insert(worktreeMetadata)
      .values({
        worktreePath: '/workspace/worktrees/fix-123',
        branch: 'fix-123',
        sourceRef: 'main',
        rootRepoPath: '/workspace/root',
        issueRef: 'ABCD-123',
        issueTitle: 'Fix commit graph drift',
        createdAt: new Date(now),
        updatedAt: new Date(now),
      })
      .run();

    const row = db.select().from(worktreeMetadata).where(eq(worktreeMetadata.worktreePath, '/workspace/worktrees/fix-123')).get();
    expect(row?.issueRef).toBe('ABCD-123');
    expect(row?.issueTitle).toBe('Fix commit graph drift');
  });

  it('defaults issueRef/issueTitle to null when omitted', () => {
    const now = Date.now();
    db
      .insert(worktreeMetadata)
      .values({
        worktreePath: '/workspace/worktrees/no-issue',
        branch: 'no-issue',
        sourceRef: 'main',
        rootRepoPath: '/workspace/root',
        createdAt: new Date(now),
        updatedAt: new Date(now),
      })
      .run();

    const row = db.select().from(worktreeMetadata).where(eq(worktreeMetadata.worktreePath, '/workspace/worktrees/no-issue')).get();
    expect(row?.issueRef).toBeNull();
    expect(row?.issueTitle).toBeNull();
  });

  it('stores hook definitions', () => {
    const now = Date.now();
    db
      .insert(hookDefinitions)
      .values({
        id: 'hook-1',
        name: 'install deps',
        scope: 'worktree',
        trigger: 'after_worktree_create',
        executionTarget: 'trigger_worktree',
        shell: 'zsh',
        script: 'pnpm install',
        createdAt: new Date(now),
        updatedAt: new Date(now),
      })
      .run();

    const rows = db.select().from(hookDefinitions).all();
    expect(rows).toHaveLength(1);
    expect(rows[0]?.name).toBe('install deps');
  });
});
