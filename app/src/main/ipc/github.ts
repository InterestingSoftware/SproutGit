import { ipcMain, safeStorage } from 'electron';
import { join } from 'path';
import { readFileSync, writeFileSync, unlinkSync, existsSync } from 'fs';
import { IPC } from '@sproutgit/types';
import type { DeviceCodeResponse, GitHubPollResult, GitHubAuthStatus, GitHubEmailSuggestion } from '@sproutgit/types';
import { deviceFlowStart, deviceFlowPoll, listEmails, listRepos } from '@sproutgit/provider-github';

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

// ── IPC registration ──────────────────────────────────────────────────────────

export function registerGithubHandlers(userDataPath: string): void {
  ipcMain.handle(IPC.GITHUB_AUTH_STATUS, (): GitHubAuthStatus => {
    const cred = getStoredGithubToken(userDataPath);
    if (!cred) return { authenticated: false, username: null, provider: 'github' };
    return { authenticated: true, username: cred.username, provider: 'github' };
  });

  ipcMain.handle(IPC.GITHUB_DEVICE_FLOW_START, (): Promise<DeviceCodeResponse> =>
    deviceFlowStart(),
  );

  ipcMain.handle(IPC.GITHUB_DEVICE_FLOW_POLL, async (_e, deviceCode: string): Promise<GitHubPollResult> => {
    const result = await deviceFlowPoll(deviceCode);
    if (result.status === 'complete' && result.accessToken) {
      saveToken(userDataPath, result.accessToken, result.username);
    }
    return { status: result.status, username: result.username, error: result.error };
  });

  ipcMain.handle(IPC.GITHUB_LOGOUT, () => {
    deleteToken(userDataPath);
  });

  ipcMain.handle(IPC.GITHUB_LIST_EMAILS, async (): Promise<GitHubEmailSuggestion[]> => {
    const cred = getStoredGithubToken(userDataPath);
    if (!cred) return [];
    return listEmails(cred.token);
  });

  ipcMain.handle(IPC.GITHUB_LIST_REPOS, async () => {
    const cred = getStoredGithubToken(userDataPath);
    if (!cred) return [];
    return listRepos(cred.token);
  });
}
