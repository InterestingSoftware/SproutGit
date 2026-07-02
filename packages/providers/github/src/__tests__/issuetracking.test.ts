import { describe, it, expect, vi, afterEach } from 'vitest';
import { parseGithubIssueUrl, fetchGithubIssue } from '../index.js';

describe('parseGithubIssueUrl', () => {
  it('parses an issue URL', () => {
    expect(parseGithubIssueUrl('https://github.com/InterestingSoftware/SproutGit/issues/123')).toEqual({
      owner: 'InterestingSoftware',
      repo: 'SproutGit',
      issueNumber: 123,
    });
  });

  it('parses a pull request URL', () => {
    expect(parseGithubIssueUrl('https://github.com/InterestingSoftware/SproutGit/pull/45')).toEqual({
      owner: 'InterestingSoftware',
      repo: 'SproutGit',
      issueNumber: 45,
    });
  });

  it('returns null for a non-GitHub URL', () => {
    expect(parseGithubIssueUrl('https://gitlab.com/org/repo/issues/1')).toBeNull();
  });

  it('returns null for a malformed URL', () => {
    expect(parseGithubIssueUrl('not a url')).toBeNull();
  });

  it('returns null for a GitHub URL that is not an issue/PR', () => {
    expect(parseGithubIssueUrl('https://github.com/InterestingSoftware/SproutGit')).toBeNull();
  });
});

describe('fetchGithubIssue', () => {
  const originalFetch = global.fetch;

  afterEach(() => {
    global.fetch = originalFetch;
  });

  it('returns null for a non-GitHub URL without calling fetch', async () => {
    const fetchSpy = vi.fn();
    global.fetch = fetchSpy as unknown as typeof fetch;
    const result = await fetchGithubIssue('https://gitlab.com/org/repo/issues/1', 'token');
    expect(result).toBeNull();
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('returns null when the API call fails', async () => {
    global.fetch = vi.fn().mockResolvedValue({ ok: false }) as unknown as typeof fetch;
    const result = await fetchGithubIssue('https://github.com/org/repo/issues/1', 'token');
    expect(result).toBeNull();
  });

  it('maps a successful response to a ProviderIssue', async () => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({
        title: 'Fix commit graph drift',
        body: 'Some description',
        html_url: 'https://github.com/org/repo/issues/1',
        state: 'open',
      }),
    }) as unknown as typeof fetch;

    const result = await fetchGithubIssue('https://github.com/org/repo/issues/1', 'token');
    expect(result).toEqual({
      id: '1',
      title: 'Fix commit graph drift',
      description: 'Some description',
      url: 'https://github.com/org/repo/issues/1',
      state: 'open',
    });
  });
});
