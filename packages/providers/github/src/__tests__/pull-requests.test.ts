import { describe, it, expect, vi, afterEach } from 'vitest';
import {
  parseGithubRemoteUrl,
  findPullRequestForBranch,
  getCombinedCheckState,
  getPullRequestStatus,
  createPullRequest,
  getPullRequestChecks,
  getCheckFailureDetail,
  setPullRequestReadyForReview,
  mergePullRequest,
} from '../index.js';

describe('parseGithubRemoteUrl', () => {
  it('parses an https URL with .git suffix', () => {
    expect(parseGithubRemoteUrl('https://github.com/InterestingSoftware/SproutGit.git')).toEqual({
      owner: 'InterestingSoftware',
      repo: 'SproutGit',
    });
  });

  it('parses an https URL without .git suffix', () => {
    expect(parseGithubRemoteUrl('https://github.com/InterestingSoftware/SproutGit')).toEqual({
      owner: 'InterestingSoftware',
      repo: 'SproutGit',
    });
  });

  it('parses an scp-like ssh URL', () => {
    expect(parseGithubRemoteUrl('git@github.com:InterestingSoftware/SproutGit.git')).toEqual({
      owner: 'InterestingSoftware',
      repo: 'SproutGit',
    });
  });

  it('parses an ssh:// URL', () => {
    expect(parseGithubRemoteUrl('ssh://git@github.com/InterestingSoftware/SproutGit.git')).toEqual({
      owner: 'InterestingSoftware',
      repo: 'SproutGit',
    });
  });

  it('returns null for a non-GitHub remote', () => {
    expect(parseGithubRemoteUrl('https://gitlab.com/org/repo.git')).toBeNull();
  });

  it('returns null for a malformed URL', () => {
    expect(parseGithubRemoteUrl('not a url')).toBeNull();
  });
});

describe('findPullRequestForBranch', () => {
  const originalFetch = global.fetch;

  afterEach(() => {
    global.fetch = originalFetch;
  });

  it('returns null when the API call fails', async () => {
    global.fetch = vi.fn().mockResolvedValue({ ok: false }) as unknown as typeof fetch;
    const result = await findPullRequestForBranch('acme', 'widgets', 'feat/x', 'token');
    expect(result).toBeNull();
  });

  it('returns null (rather than throwing) when fetch rejects at the transport level', async () => {
    global.fetch = vi.fn().mockRejectedValue(new TypeError('network error')) as unknown as typeof fetch;
    const result = await findPullRequestForBranch('acme', 'widgets', 'feat/x', 'token');
    expect(result).toBeNull();
  });

  it('returns null when no PR is found', async () => {
    global.fetch = vi.fn().mockResolvedValue({ ok: true, json: () => Promise.resolve([]) }) as unknown as typeof fetch;
    const result = await findPullRequestForBranch('acme', 'widgets', 'feat/x', 'token');
    expect(result).toBeNull();
  });

  it('maps an open PR', async () => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve([{
        number: 42,
        html_url: 'https://github.com/acme/widgets/pull/42',
        title: 'Add widget',
        state: 'open',
        draft: false,
        head: { ref: 'feat/x' },
        base: { ref: 'main' },
        merged_at: null,
      }]),
    }) as unknown as typeof fetch;
    const result = await findPullRequestForBranch('acme', 'widgets', 'feat/x', 'token');
    expect(result).toEqual({
      number: 42,
      url: 'https://github.com/acme/widgets/pull/42',
      title: 'Add widget',
      state: 'open',
      draft: false,
      headBranch: 'feat/x',
      baseBranch: 'main',
    });
  });

  it('maps a draft PR', async () => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve([{
        number: 7, html_url: 'u', title: 't', state: 'open', draft: true,
        head: { ref: 'feat/x' }, base: { ref: 'main' }, merged_at: null,
      }]),
    }) as unknown as typeof fetch;
    const result = await findPullRequestForBranch('acme', 'widgets', 'feat/x', 'token');
    expect(result?.draft).toBe(true);
    expect(result?.state).toBe('open');
  });

  it('maps a merged PR (state closed + merged_at set) as "merged"', async () => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve([{
        number: 7, html_url: 'u', title: 't', state: 'closed', draft: false,
        head: { ref: 'feat/x' }, base: { ref: 'main' }, merged_at: '2026-01-01T00:00:00Z',
      }]),
    }) as unknown as typeof fetch;
    const result = await findPullRequestForBranch('acme', 'widgets', 'feat/x', 'token');
    expect(result?.state).toBe('merged');
  });

  it('maps a closed-unmerged PR as "closed"', async () => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve([{
        number: 7, html_url: 'u', title: 't', state: 'closed', draft: false,
        head: { ref: 'feat/x' }, base: { ref: 'main' }, merged_at: null,
      }]),
    }) as unknown as typeof fetch;
    const result = await findPullRequestForBranch('acme', 'widgets', 'feat/x', 'token');
    expect(result?.state).toBe('closed');
  });
});

describe('getCombinedCheckState', () => {
  const originalFetch = global.fetch;

  afterEach(() => {
    global.fetch = originalFetch;
  });

  function mockFetchFor(statusBody: unknown, checkRunsBody: unknown, ok = true) {
    global.fetch = vi.fn((url: string) => {
      if (url.includes('/check-runs')) {
        return Promise.resolve({ ok, json: () => Promise.resolve(checkRunsBody) });
      }
      return Promise.resolve({ ok, json: () => Promise.resolve(statusBody) });
    }) as unknown as typeof fetch;
  }

  it('returns "none" when neither API has any checks', async () => {
    mockFetchFor({ state: 'pending', statuses: [] }, { check_runs: [] });
    expect(await getCombinedCheckState('acme', 'widgets', 'abc123', 'token')).toBe('none');
  });

  it('returns "none" (rather than throwing) when fetch rejects at the transport level', async () => {
    global.fetch = vi.fn().mockRejectedValue(new TypeError('network error')) as unknown as typeof fetch;
    expect(await getCombinedCheckState('acme', 'widgets', 'abc123', 'token')).toBe('none');
  });

  it('returns "passing" when combined status is success', async () => {
    mockFetchFor({ state: 'success', statuses: [{}] }, { check_runs: [] });
    expect(await getCombinedCheckState('acme', 'widgets', 'abc123', 'token')).toBe('passing');
  });

  it('returns "failing" when combined status is failure', async () => {
    mockFetchFor({ state: 'failure', statuses: [{}] }, { check_runs: [] });
    expect(await getCombinedCheckState('acme', 'widgets', 'abc123', 'token')).toBe('failing');
  });

  it('returns "pending" when a check-run is still in progress', async () => {
    mockFetchFor({ state: 'success', statuses: [] }, { check_runs: [{ status: 'in_progress', conclusion: null }] });
    expect(await getCombinedCheckState('acme', 'widgets', 'abc123', 'token')).toBe('pending');
  });

  it('returns "failing" when a completed check-run has a failure conclusion, even if the combined status is pending', async () => {
    mockFetchFor(
      { state: 'pending', statuses: [{}] },
      { check_runs: [{ status: 'completed', conclusion: 'failure' }] },
    );
    expect(await getCombinedCheckState('acme', 'widgets', 'abc123', 'token')).toBe('failing');
  });

  it('returns "passing" when all check-runs completed successfully', async () => {
    mockFetchFor(
      { state: 'success', statuses: [{}] },
      { check_runs: [{ status: 'completed', conclusion: 'success' }, { status: 'completed', conclusion: 'neutral' }] },
    );
    expect(await getCombinedCheckState('acme', 'widgets', 'abc123', 'token')).toBe('passing');
  });
});

describe('getPullRequestStatus', () => {
  const originalFetch = global.fetch;

  afterEach(() => {
    global.fetch = originalFetch;
  });

  it('returns null PR + "none" checks when there is no PR for the branch', async () => {
    global.fetch = vi.fn().mockResolvedValue({ ok: true, json: () => Promise.resolve([]) }) as unknown as typeof fetch;
    const result = await getPullRequestStatus('acme', 'widgets', 'feat/x', 'token');
    expect(result).toEqual({ pullRequest: null, checksState: 'none', checks: [] });
  });

  it('combines the found PR with its combined check state', async () => {
    global.fetch = vi.fn((url: string) => {
      if (url.includes('/pulls?')) {
        return Promise.resolve({
          ok: true,
          json: () => Promise.resolve([{
            number: 42, html_url: 'u', title: 't', state: 'open', draft: false,
            head: { ref: 'feat/x' }, base: { ref: 'main' }, merged_at: null,
          }]),
        });
      }
      if (url.includes('/check-runs')) {
        return Promise.resolve({ ok: true, json: () => Promise.resolve({ check_runs: [{ status: 'completed', conclusion: 'success' }] }) });
      }
      return Promise.resolve({ ok: true, json: () => Promise.resolve({ state: 'success', statuses: [] }) });
    }) as unknown as typeof fetch;

    const result = await getPullRequestStatus('acme', 'widgets', 'feat/x', 'token');
    expect(result.pullRequest?.number).toBe(42);
    expect(result.checksState).toBe('passing');
  });
});

describe('createPullRequest', () => {
  const originalFetch = global.fetch;

  afterEach(() => {
    global.fetch = originalFetch;
  });

  it('posts to the pulls endpoint and maps the response', async () => {
    const fetchSpy = vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({
        number: 99, html_url: 'https://github.com/acme/widgets/pull/99', title: 'My PR',
        state: 'open', draft: true, head: { ref: 'feat/x' }, base: { ref: 'main' }, merged_at: null,
      }),
    });
    global.fetch = fetchSpy as unknown as typeof fetch;

    const result = await createPullRequest(
      { owner: 'acme', repo: 'widgets', head: 'feat/x', base: 'main', title: 'My PR', draft: true },
      'token',
    );

    expect(result.number).toBe(99);
    expect(result.draft).toBe(true);
    const [url, init] = fetchSpy.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('https://api.github.com/repos/acme/widgets/pulls');
    expect(init.method).toBe('POST');
    expect(JSON.parse(init.body as string)).toEqual({
      title: 'My PR', body: '', head: 'feat/x', base: 'main', draft: true,
    });
  });

  it('throws when the API call fails', async () => {
    global.fetch = vi.fn().mockResolvedValue({ ok: false, status: 422, text: () => Promise.resolve('validation failed') }) as unknown as typeof fetch;
    await expect(createPullRequest(
      { owner: 'acme', repo: 'widgets', head: 'feat/x', base: 'main', title: 'My PR' },
      'token',
    )).rejects.toThrow(/422/);
  });
});

describe('getPullRequestChecks', () => {
  const originalFetch = global.fetch;

  afterEach(() => {
    global.fetch = originalFetch;
  });

  function mockFetchFor(statusBody: unknown, checkRunsBody: unknown, ok = true) {
    global.fetch = vi.fn((url: string) => {
      if (url.includes('/check-runs')) {
        return Promise.resolve({ ok, json: () => Promise.resolve(checkRunsBody) });
      }
      return Promise.resolve({ ok, json: () => Promise.resolve(statusBody) });
    }) as unknown as typeof fetch;
  }

  it('returns an empty list when neither API has any checks', async () => {
    mockFetchFor({ statuses: [] }, { check_runs: [] });
    expect(await getPullRequestChecks('acme', 'widgets', 'abc123', 'token')).toEqual([]);
  });

  it('returns an empty list (rather than throwing) when fetch rejects at the transport level', async () => {
    global.fetch = vi.fn().mockRejectedValue(new TypeError('network error')) as unknown as typeof fetch;
    expect(await getPullRequestChecks('acme', 'widgets', 'abc123', 'token')).toEqual([]);
  });

  it('maps legacy commit statuses', async () => {
    mockFetchFor(
      { statuses: [{ id: 1, context: 'ci/build', state: 'success', target_url: 'https://ci/1' }] },
      { check_runs: [] },
    );
    expect(await getPullRequestChecks('acme', 'widgets', 'abc123', 'token')).toEqual([{
      id: 'status:1',
      name: 'ci/build',
      source: 'status',
      status: 'completed',
      conclusion: 'success',
      detailsUrl: 'https://ci/1',
    }]);
  });

  it('maps a pending legacy status as in_progress with a null conclusion', async () => {
    mockFetchFor(
      { statuses: [{ id: 1, context: 'ci/build', state: 'pending', target_url: null }] },
      { check_runs: [] },
    );
    const [check] = await getPullRequestChecks('acme', 'widgets', 'abc123', 'token');
    expect(check).toMatchObject({ status: 'in_progress', conclusion: null });
  });

  it('maps Checks API runs, falling back to html_url when details_url is absent', async () => {
    mockFetchFor(
      { statuses: [] },
      { check_runs: [{ id: 9, name: 'build', status: 'completed', conclusion: 'failure', details_url: null, html_url: 'https://gh/run/9' }] },
    );
    expect(await getPullRequestChecks('acme', 'widgets', 'abc123', 'token')).toEqual([{
      id: 'check_run:9',
      name: 'build',
      source: 'check_run',
      status: 'completed',
      conclusion: 'failure',
      detailsUrl: 'https://gh/run/9',
    }]);
  });

  it('combines both sources into one list', async () => {
    mockFetchFor(
      { statuses: [{ id: 1, context: 'legacy', state: 'success', target_url: null }] },
      { check_runs: [{ id: 2, name: 'build', status: 'completed', conclusion: 'success', details_url: 'https://gh/2', html_url: null }] },
    );
    const checks = await getPullRequestChecks('acme', 'widgets', 'abc123', 'token');
    expect(checks).toHaveLength(2);
    expect(checks.map(c => c.id)).toEqual(['status:1', 'check_run:2']);
  });
});

describe('getCheckFailureDetail', () => {
  const originalFetch = global.fetch;

  afterEach(() => {
    global.fetch = originalFetch;
  });

  it('returns null for a legacy status id (no failure detail endpoint exists)', async () => {
    global.fetch = vi.fn() as unknown as typeof fetch;
    expect(await getCheckFailureDetail('acme', 'widgets', 'status:1', 'token')).toBeNull();
    expect(global.fetch).not.toHaveBeenCalled();
  });

  it('returns null when the check-run lookup fails', async () => {
    global.fetch = vi.fn().mockResolvedValue({ ok: false }) as unknown as typeof fetch;
    expect(await getCheckFailureDetail('acme', 'widgets', 'check_run:9', 'token')).toBeNull();
  });

  it('returns null (rather than throwing) when fetch rejects at the transport level', async () => {
    global.fetch = vi.fn().mockRejectedValue(new TypeError('network error')) as unknown as typeof fetch;
    expect(await getCheckFailureDetail('acme', 'widgets', 'check_run:9', 'token')).toBeNull();
  });

  it('fetches the run summary/text plus annotations', async () => {
    global.fetch = vi.fn((url: string) => {
      if (url.includes('/annotations')) {
        return Promise.resolve({
          ok: true,
          json: () => Promise.resolve([{
            path: 'src/index.ts', start_line: 10, end_line: 12, annotation_level: 'failure', message: 'boom', title: 'Type error',
          }]),
        });
      }
      return Promise.resolve({
        ok: true,
        json: () => Promise.resolve({ name: 'build', output: { summary: 'Build failed', text: 'full log' } }),
      });
    }) as unknown as typeof fetch;

    expect(await getCheckFailureDetail('acme', 'widgets', 'check_run:9', 'token')).toEqual({
      name: 'build',
      summary: 'Build failed',
      text: 'full log',
      annotations: [{ path: 'src/index.ts', startLine: 10, endLine: 12, annotationLevel: 'failure', message: 'boom', title: 'Type error' }],
    });
  });

  it('degrades to an empty annotations list when the annotations call fails', async () => {
    global.fetch = vi.fn((url: string) => {
      if (url.includes('/annotations')) return Promise.resolve({ ok: false });
      return Promise.resolve({ ok: true, json: () => Promise.resolve({ name: 'build', output: null }) });
    }) as unknown as typeof fetch;

    expect(await getCheckFailureDetail('acme', 'widgets', 'check_run:9', 'token')).toEqual({
      name: 'build',
      summary: null,
      text: null,
      annotations: [],
    });
  });
});

describe('setPullRequestReadyForReview', () => {
  const originalFetch = global.fetch;

  afterEach(() => {
    global.fetch = originalFetch;
  });

  it('sends the markPullRequestReadyForReview mutation when ready=true', async () => {
    const fetchSpy = vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ data: { markPullRequestReadyForReview: { pullRequest: { id: 'node1' } } } }),
    });
    global.fetch = fetchSpy as unknown as typeof fetch;

    await setPullRequestReadyForReview('node1', true, 'token');

    const [url, init] = fetchSpy.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('https://api.github.com/graphql');
    const body = JSON.parse(init.body as string) as { query: string; variables: { id: string } };
    expect(body.query).toContain('markPullRequestReadyForReview');
    expect(body.variables).toEqual({ id: 'node1' });
  });

  it('sends the convertPullRequestToDraft mutation when ready=false', async () => {
    const fetchSpy = vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ data: { convertPullRequestToDraft: { pullRequest: { id: 'node1' } } } }),
    });
    global.fetch = fetchSpy as unknown as typeof fetch;

    await setPullRequestReadyForReview('node1', false, 'token');

    const [, init] = fetchSpy.mock.calls[0] as [string, RequestInit];
    const body = JSON.parse(init.body as string) as { query: string };
    expect(body.query).toContain('convertPullRequestToDraft');
  });

  it('throws when the HTTP call fails', async () => {
    global.fetch = vi.fn().mockResolvedValue({ ok: false, status: 401, text: () => Promise.resolve('bad token') }) as unknown as typeof fetch;
    await expect(setPullRequestReadyForReview('node1', true, 'token')).rejects.toThrow(/401/);
  });

  it('throws when GraphQL returns errors despite a 200 response', async () => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ errors: [{ message: 'Pull request is already ready for review' }] }),
    }) as unknown as typeof fetch;
    await expect(setPullRequestReadyForReview('node1', true, 'token')).rejects.toThrow(/already ready for review/);
  });
});

describe('mergePullRequest', () => {
  const originalFetch = global.fetch;

  afterEach(() => {
    global.fetch = originalFetch;
  });

  it('PUTs to the merge endpoint with the requested method', async () => {
    const fetchSpy = vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ merged: true, message: 'Pull Request successfully merged' }),
    });
    global.fetch = fetchSpy as unknown as typeof fetch;

    const result = await mergePullRequest('acme', 'widgets', 42, 'squash', 'token');

    expect(result).toEqual({ merged: true, message: 'Pull Request successfully merged' });
    const [url, init] = fetchSpy.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('https://api.github.com/repos/acme/widgets/pulls/42/merge');
    expect(init.method).toBe('PUT');
    expect(JSON.parse(init.body as string)).toEqual({ merge_method: 'squash' });
  });

  it('throws with the GitHub message when the merge fails (e.g. not mergeable)', async () => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: false,
      status: 405,
      json: () => Promise.resolve({ message: 'Pull Request is not mergeable' }),
    }) as unknown as typeof fetch;
    await expect(mergePullRequest('acme', 'widgets', 42, 'merge', 'token')).rejects.toThrow(/not mergeable/);
  });
});
