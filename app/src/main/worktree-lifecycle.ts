/**
 * The single, canonical "create a worktree" / "remove a worktree" operation
 * — runs the before/after lifecycle hooks, records issue-ref provenance,
 * and cleans up terminals around the actual git operation.
 *
 * Both the renderer's worktree:create/worktree:delete IPC calls (git.ts)
 * and the MCP create_worktree/remove_worktree tools (via mcp-bridge.ts)
 * call through these two functions, so a worktree created or removed by an
 * agent behaves the same as one created or removed from the UI — hooks
 * fire, provenance is recorded, stale terminals are closed — instead of an
 * agent-driven change silently skipping all of that.
 *
 * What's deliberately NOT here: switching the renderer's "active worktree"
 * selection and its own before/after_worktree_switch hooks. That's a UI
 * navigation concern with no MCP equivalent (an agent has no notion of
 * "the worktree currently in view"), so the renderer still orchestrates
 * that part itself around these calls.
 */
import type { BrowserWindow } from 'electron';
import { canonicalize } from '@sproutgit/paths';
import { createManagedWorktree, createFirstManagedWorktree, deleteManagedWorktree, listWorktrees } from '@sproutgit/git';
import type { CreateWorktreeResult } from '@sproutgit/types';
import type { ConfigDb } from '@sproutgit/database';
import { runTriggerHooks } from './ipc/hooks.js';
import { setWorktreeMeta } from './ipc/workspace.js';
import { manager } from './ipc/terminal.js';

export type CreateWorktreeWithHooksParams = {
  workspacePath: string;
  rootRepoPath: string;
  managedWorktreesPath: string;
  fromRef: string;
  newBranch: string;
  /** The worktree the caller was "in" when starting the operation, if any — used as before-hook context and recorded as SPROUTGIT_INITIATING_WORKTREE. */
  initiatingWorktreePath?: string | null;
  issueRef?: string | null;
  issueTitle?: string | null;
  /** True for the very first worktree of a brand-new, zero-commit repo — uses `--orphan` instead of `fromRef`, which is meaningless before any commit exists. */
  orphan?: boolean;
};

export async function createWorktreeWithHooks(
  params: CreateWorktreeWithHooksParams,
  getWindow: () => BrowserWindow | null,
  configDb: ConfigDb,
): Promise<CreateWorktreeResult> {
  const win = getWindow();
  const initiatingWorktreePath = params.initiatingWorktreePath ?? null;

  // Hooks are a visible-terminal feature tied to an open window for this
  // workspace — if none is open (e.g. an MCP call against a workspace whose
  // window isn't currently focused/open), skip them rather than erroring,
  // matching every other hook call site's `if (!win) return;` behavior.
  if (win) {
    await runTriggerHooks({
      workspacePath: params.workspacePath,
      trigger: 'before_worktree_create',
      worktreePath: initiatingWorktreePath ?? params.workspacePath,
      initiatingWorktreePath,
    }, win, configDb);
  }

  const result = params.orphan
    ? await createFirstManagedWorktree(params.rootRepoPath, params.managedWorktreesPath, params.newBranch)
    : await createManagedWorktree(params.rootRepoPath, params.managedWorktreesPath, params.fromRef, params.newBranch);

  if (params.issueRef) {
    setWorktreeMeta({
      workspacePath: params.workspacePath,
      worktreePath: result.worktreePath,
      issueRef: params.issueRef,
      issueTitle: params.issueTitle ?? null,
    });
  }

  if (win) {
    await runTriggerHooks({
      workspacePath: params.workspacePath,
      trigger: 'after_worktree_create',
      worktreePath: result.worktreePath,
      initiatingWorktreePath,
    }, win, configDb);
  }

  return result;
}

export type RemoveWorktreeWithHooksParams = {
  workspacePath: string;
  rootRepoPath: string;
  managedWorktreesPath?: string;
  worktreePath: string;
  deleteBranch: boolean;
  branchName?: string | null;
  initiatingWorktreePath?: string | null;
  /** Worktree context for the after-remove hook (e.g. the UI's "next active" worktree). Defaults to workspacePath when omitted. */
  afterRemoveWorktreePath?: string | null;
};

export async function removeWorktreeWithHooks(
  params: RemoveWorktreeWithHooksParams,
  getWindow: () => BrowserWindow | null,
  configDb: ConfigDb,
): Promise<void> {
  // Validate against git's own worktree list rather than trusting the
  // caller-supplied path — only ever remove a path git itself has
  // registered against this repo. canonicalize() (realpath) on both sides
  // so e.g. macOS's /var vs /private/var doesn't cause a legitimately
  // registered worktree to be refused.
  const { worktrees } = await listWorktrees(params.rootRepoPath, params.managedWorktreesPath);
  const resolvedTarget = canonicalize(params.worktreePath);
  const match = worktrees.find(w => canonicalize(w.path) === resolvedTarget);
  if (!match) {
    throw new Error('Refusing to remove: path is not a registered worktree of this repository.');
  }
  // Defense in depth: never delete the branch of an external worktree, even
  // if the caller asked for it — an external tool owns that branch.
  const deleteBranch = params.deleteBranch && !match.isExternal;

  const win = getWindow();
  const initiatingWorktreePath = params.initiatingWorktreePath ?? null;

  if (win) {
    await runTriggerHooks({
      workspacePath: params.workspacePath,
      trigger: 'before_worktree_remove',
      worktreePath: match.path,
      initiatingWorktreePath,
    }, win, configDb);
  }

  // Stale PTY sessions pointing at a directory that's about to be deleted
  // should never linger, regardless of who triggered the removal.
  manager.closeForPath(match.path);

  // Same external-worktree carve-out as the branch-deletion guard above: an
  // external worktree lives outside managedWorktreesPath by definition, so
  // only pass it through for the path containment check when this is a
  // worktree we actually manage.
  await deleteManagedWorktree(
    params.rootRepoPath,
    match.path,
    deleteBranch,
    params.branchName ?? null,
    match.isExternal ? undefined : params.managedWorktreesPath
  );

  if (win) {
    await runTriggerHooks({
      workspacePath: params.workspacePath,
      trigger: 'after_worktree_remove',
      worktreePath: params.afterRemoveWorktreePath ?? params.workspacePath,
      initiatingWorktreePath,
    }, win, configDb);
  }
}
