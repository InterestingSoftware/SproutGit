import { type StashEntry, type StashListResult } from '@sproutgit/types';
import { gitForPath } from './client.js';

/**
 * Creates a stash of the current working-tree + index state.
 * Uses `stash push` (not the deprecated `stash save`) so an optional
 * message can be attached without relying on positional-arg parsing.
 * Includes untracked files (`-u`) — the UI's "changes to stash" check counts
 * untracked files too, so without `-u` a stash of an untracked-only change
 * would silently no-op ("No local changes to save") while still reporting
 * success.
 */
export async function createStash(worktreePath: string, message?: string): Promise<void> {
  const git = gitForPath(worktreePath);
  const args = message ? ['push', '-u', '-m', message] : ['push', '-u'];
  await git.stash(args);
}

/**
 * Lists all stashes for the worktree, newest first (matching `git stash list`
 * order). `entry.ref` (e.g. `stash@{0}`) is what apply/pop/drop expect —
 * it's derived from list position since simple-git's `stashList()` returns
 * plain log entries with no ref field of their own.
 */
export async function listStashes(worktreePath: string): Promise<StashListResult> {
  const git = gitForPath(worktreePath);
  const result = await git.stashList();

  const stashes: StashEntry[] = result.all.map((entry, index) => ({
    index,
    ref: `stash@{${index}}`,
    hash: entry.hash,
    message: entry.message,
    date: entry.date,
  }));

  return { worktreePath, stashes };
}

/**
 * Applies a stash without removing it from the stash list.
 */
export async function applyStash(worktreePath: string, ref: string): Promise<void> {
  const git = gitForPath(worktreePath);
  await git.stash(['apply', ref]);
}

/**
 * Applies a stash and removes it from the stash list if the apply succeeds.
 * (If it conflicts, git leaves the stash entry in place — same as the CLI.)
 */
export async function popStash(worktreePath: string, ref: string): Promise<void> {
  const git = gitForPath(worktreePath);
  await git.stash(['pop', ref]);
}

/**
 * Deletes a stash entry without applying it.
 */
export async function dropStash(worktreePath: string, ref: string): Promise<void> {
  const git = gitForPath(worktreePath);
  await git.stash(['drop', ref]);
}
