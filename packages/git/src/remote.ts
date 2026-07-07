import { type WorktreePushStatus, type PushBranchResult, type FetchSummary } from '@sproutgit/types';
import { gitForPath } from './client.js';

/**
 * Fetches latest refs from all remotes for a worktree.
 *
 * Returns a `FetchSummary` rather than `void` so the caller can tell apart
 * three outcomes that would otherwise all look like an identical resolved
 * promise: no remotes configured at all (fetch is skipped — running
 * `git fetch --all` with zero remotes is a silent, meaningless no-op),
 * everything already up to date, or N ref(s) actually updated/pruned. This
 * is what makes fetch look like it "doesn't do anything" even when it
 * succeeded — a bare success with no information isn't distinguishable
 * from nothing having happened.
 */
export async function fetchWorktree(worktreePath: string): Promise<FetchSummary> {
  const git = gitForPath(worktreePath);

  const remotes = await git.getRemotes(false);
  if (remotes.length === 0) {
    return { worktreePath, hadNoRemotes: true, updatedRefCount: 0, prunedRefCount: 0 };
  }

  const result = await git.fetch(['--all', '--prune']);
  return {
    worktreePath,
    hadNoRemotes: false,
    updatedRefCount: result.updated.length,
    prunedRefCount: result.deleted.length,
  };
}

/**
 * Pulls (fast-forward only) from the tracking upstream.
 */
export async function pullWorktree(worktreePath: string): Promise<void> {
  const git = gitForPath(worktreePath);
  await git.pull(['--ff-only']);
}

/**
 * Pushes the current branch to its upstream (or publishes to `publishRemote`).
 */
export async function pushWorktreeBranch(
  worktreePath: string,
  publishRemote?: string | null
): Promise<PushBranchResult> {
  const git = gitForPath(worktreePath);
  const status = await git.status();
  const branch = status.current ?? '';

  let upstream = status.tracking;
  let published = false;

  if (!upstream && publishRemote) {
    // First push — set upstream automatically.
    await git.raw(['push', '--set-upstream', publishRemote, branch]);
    upstream = `${publishRemote}/${branch}`;
    published = true;
  } else {
    await git.push();
  }

  return { worktreePath, branch, upstream: upstream ?? null, published };
}

/**
 * Returns the fetch URL for a named remote (defaults to "origin"), or null
 * if the worktree has no remotes / the named remote doesn't exist. Falls
 * back to the first configured remote when the named one is missing.
 */
export async function getRemoteUrl(worktreePath: string, remoteName = 'origin'): Promise<string | null> {
  const git = gitForPath(worktreePath);
  const remotes = await git.getRemotes(true);
  const remote = remotes.find(r => r.name === remoteName) ?? remotes[0];
  return remote?.refs.fetch ?? null;
}

/**
 * Returns a summary of the push state for the current branch:
 * whether it has an upstream, which remotes are available, etc.
 */
export async function getWorktreePushStatus(worktreePath: string): Promise<WorktreePushStatus> {
  const git = gitForPath(worktreePath);
  const status = await git.status();

  const remoteRaw = await git.getRemotes(false);
  const remotes = remoteRaw.map(r => r.name);

  // Heuristic: prefer "origin" if it exists, otherwise the first remote.
  const suggestedRemote = remotes.includes('origin') ? 'origin' : (remotes[0] ?? null);

  return {
    worktreePath,
    branch: status.current ?? null,
    upstream: status.tracking ?? null,
    remotes,
    suggestedRemote,
    detached: status.detached,
  };
}
