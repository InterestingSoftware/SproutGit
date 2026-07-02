import { describe, it, expect, vi, beforeEach } from 'vitest';

const { handleMock, getStoredGithubTokenMock, fetchGithubIssueMock } = vi.hoisted(() => ({
  handleMock: vi.fn(),
  getStoredGithubTokenMock: vi.fn(),
  fetchGithubIssueMock: vi.fn(),
}));

vi.mock('electron', () => ({ ipcMain: { handle: handleMock } }));
vi.mock('../../telemetry.js', () => ({ log: { error: vi.fn(), info: vi.fn(), warn: vi.fn() } }));
vi.mock('@sproutgit/provider-github', () => ({
  fetchGithubIssue: (...args: unknown[]) => fetchGithubIssueMock(...args),
}));
vi.mock('../github.js', () => ({
  getStoredGithubToken: (...args: unknown[]) => getStoredGithubTokenMock(...args),
}));

import { registerProviderHandlers } from '../providers.js';

type Handler = (event: unknown, url: string) => Promise<unknown>;

function getRegisteredHandler(): Handler {
  registerProviderHandlers('/fake/userData');
  const call = handleMock.mock.calls.find(c => c[0] === 'provider:fetchIssue');
  if (!call) throw new Error('provider:fetchIssue handler was not registered');
  return call[1] as Handler;
}

describe('provider:fetchIssue', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns null for an unrecognized hostname without touching credentials', async () => {
    const handler = getRegisteredHandler();
    const result = await handler({}, 'https://gitlab.com/org/repo/issues/1');
    expect(result).toBeNull();
    expect(getStoredGithubTokenMock).not.toHaveBeenCalled();
    expect(fetchGithubIssueMock).not.toHaveBeenCalled();
  });

  it('returns null when GitHub is detected but no token is stored', async () => {
    getStoredGithubTokenMock.mockReturnValue(null);
    const handler = getRegisteredHandler();
    const result = await handler({}, 'https://github.com/org/repo/issues/1');
    expect(result).toBeNull();
    expect(fetchGithubIssueMock).not.toHaveBeenCalled();
  });

  it('fetches the issue when GitHub is detected and a token is stored', async () => {
    getStoredGithubTokenMock.mockReturnValue({ token: 'gh-token', username: 'octocat' });
    fetchGithubIssueMock.mockResolvedValue({ id: '1', title: 'Bug', description: null, url: 'https://github.com/org/repo/issues/1', state: 'open' });

    const handler = getRegisteredHandler();
    const result = await handler({}, 'https://github.com/org/repo/issues/1');

    expect(fetchGithubIssueMock).toHaveBeenCalledWith('https://github.com/org/repo/issues/1', 'gh-token');
    expect(result).toEqual({ id: '1', title: 'Bug', description: null, url: 'https://github.com/org/repo/issues/1', state: 'open' });
  });
});
