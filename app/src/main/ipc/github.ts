import { safeStorage } from 'electron';
import { join } from 'path';
import { readFileSync, writeFileSync, unlinkSync, existsSync } from 'fs';
import { IPC } from '@sproutgit/types';
import type { DeviceCodeResponse, GitHubPollResult, GitHubAuthStatus, GitHubEmailSuggestion, PullRequestStatus, PullRequestInfo } from '@sproutgit/types';
import {
  deviceFlowStart,
  deviceFlowPoll,
  listEmails,
  listRepos,
  parseGithubRemoteUrl,
  getPullRequestStatus,
  createPullRequest,
} from '@sproutgit/provider-github';
import { getRemoteUrl, getWorktreePushStatus } from '@sproutgit/git';
import { handle } from './handle.js';

// ── Token storage via electron.safeStorage ────────────────────────────────────
// Kept here because safeStorage is Electron-specific and cannot live in a
// plain Node.js package.

export type StoredCredential = { token: string; username: string | null };

function tokenFilePath(userDataPath: string): string {
  return join(userDataPath, 'github-token.bin');
}

function saveToken(userDataPath: string, token: string, username: string | null): void {
  const payload = JSON.stringify({ token, username } satisfies StoredCredential);
  const encrypted = safeStorage.isEncryptionAvailable()
    ? safeStorage.encryptString(payload)
    : Buffer.from(payload, 'utf8');
  writeFileSync(tokenFilePath(userDataPath), encrypted);
}

export function getStoredGithubToken(userDataPath: string): StoredCredential | null {
  const path = tokenFilePath(userDataPath);
  if (!existsSync(path)) return null;
  try {
    const buf = readFileSync(path);
    const raw = safeStorage.isEncryptionAvailable()
      ? safeStorage.decryptString(buf)
      : buf.toString('utf8');
    return JSON.parse(raw) as StoredCredential;
  } catch {
    return null;
  }
}

function deleteToken(userDataPath: string): void {
  const path = tokenFilePath(userDataPath);
  if (existsSync(path)) unlinkSync(path);
}

// ── PR helpers ─────────────────────────────────────────────────────────────────

/** Resolves a worktree's GitHub owner/repo (from its `origin` remote) and current branch, or null if either is unavailable. */
async function resolveWorktreeGithubContext(
  worktreePath: string,
): Promise<{ owner: string; repo: string; branch: string } | null> {
  const remoteUrl = await getRemoteUrl(worktreePath);
  if (!remoteUrl) return null;
  const parsed = parseGithubRemoteUrl(remoteUrl);
  if (!parsed) return null;
  const pushStatus = await getWorktreePushStatus(worktreePath);
  if (!pushStatus.branch) return null;
  return { owner: parsed.owner, repo: parsed.repo, branch: pushStatus.branch };
}

// ── IPC registration ──────────────────────────────────────────────────────────

export function registerGithubHandlers(userDataPath: string): void {
  handle(IPC.GITHUB_AUTH_STATUS, (): GitHubAuthStatus => {
    const cred = getStoredGithubToken(userDataPath);
    if (!cred) return { authenticated: false, username: null, provider: 'github' };
    return { authenticated: true, username: cred.username, provider: 'github' };
  });

  handle(IPC.GITHUB_DEVICE_FLOW_START, (): Promise<DeviceCodeResponse> =>
    deviceFlowStart(),
  );

  handle(IPC.GITHUB_DEVICE_FLOW_POLL, async (_e, deviceCode: string): Promise<GitHubPollResult> => {
    const result = await deviceFlowPoll(deviceCode);
    if (result.status === 'complete' && result.accessToken) {
      saveToken(userDataPath, result.accessToken, result.username);
    }
    return { status: result.status, username: result.username, error: result.error };
  });

  handle(IPC.GITHUB_LOGOUT, () => {
    deleteToken(userDataPath);
  });

  handle(IPC.GITHUB_LIST_EMAILS, async (): Promise<GitHubEmailSuggestion[]> => {
    const cred = getStoredGithubToken(userDataPath);
    if (!cred) return [];
    return listEmails(cred.token);
  });

  handle(IPC.GITHUB_LIST_REPOS, async () => {
    const cred = getStoredGithubToken(userDataPath);
    if (!cred) return [];
    return listRepos(cred.token);
  });

  handle(IPC.GITHUB_GET_PR_STATUS, async (_e, worktreePath: string): Promise<PullRequestStatus | null> => {
    // Best-effort: this only feeds a sidebar badge, so a transient git or
    // network failure here should degrade to "no PR info" rather than
    // surfacing as a query error in the UI.
    try {
      const cred = getStoredGithubToken(userDataPath);
      if (!cred) return null;
      const context = await resolveWorktreeGithubContext(worktreePath);
      if (!context) return null;
      return await getPullRequestStatus(context.owner, context.repo, context.branch, cred.token);
    } catch {
      return null;
    }
  });

  handle(IPC.GITHUB_CREATE_PR, async (
    _e,
    args: { worktreePath: string; title: string; body?: string; base: string; draft?: boolean },
  ): Promise<PullRequestInfo> => {
    const cred = getStoredGithubToken(userDataPath);
    if (!cred) throw new Error('Not signed in to GitHub');
    const context = await resolveWorktreeGithubContext(args.worktreePath);
    if (!context) throw new Error('This worktree has no GitHub remote to open a PR against');
    return createPullRequest({
      owner: context.owner,
      repo: context.repo,
      head: context.branch,
      base: args.base,
      title: args.title,
      ...(args.body !== undefined ? { body: args.body } : {}),
      ...(args.draft !== undefined ? { draft: args.draft } : {}),
    }, cred.token);
  });
}
