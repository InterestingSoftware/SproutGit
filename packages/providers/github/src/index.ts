import type {
  DeviceCodeResponse,
  GitHubPollResult,
  GitHubEmailSuggestion,
  GitHubRepo,
  ProviderIssue,
  ChecksState,
  PullRequestInfo,
  PullRequestStatus,
  PullRequestCheck,
  CreatePullRequestInput,
  CheckFailureDetail,
  MergeMethod,
  MergePullRequestResult,
} from '@sproutgit/types';

export const GITHUB_CLIENT_ID = 'Ov23li7ulFUcqulDi8u8';

// ── Low-level fetch helpers ───────────────────────────────────────────────────

async function ghFormFetch(url: string, params: Record<string, string>): Promise<Response> {
  return fetch(url, {
    method: 'POST',
    headers: { Accept: 'application/json', 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams(params),
  });
}

async function ghApiFetch(endpoint: string, token: string): Promise<Response> {
  return fetch(`https://api.github.com${endpoint}`, {
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: 'application/json',
      'X-GitHub-Api-Version': '2022-11-28',
    },
  });
}

async function ghApiPost(endpoint: string, token: string, body: unknown): Promise<Response> {
  return fetch(`https://api.github.com${endpoint}`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: 'application/json',
      'Content-Type': 'application/json',
      'X-GitHub-Api-Version': '2022-11-28',
    },
    body: JSON.stringify(body),
  });
}

async function ghApiPut(endpoint: string, token: string, body: unknown): Promise<Response> {
  return fetch(`https://api.github.com${endpoint}`, {
    method: 'PUT',
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: 'application/json',
      'Content-Type': 'application/json',
      'X-GitHub-Api-Version': '2022-11-28',
    },
    body: JSON.stringify(body),
  });
}

/**
 * GitHub's REST API has no endpoint to flip a PR between draft and ready for
 * review — that only exists as a GraphQL mutation. Everything else in this
 * file uses REST; this is the one place that talks to `/graphql`.
 */
async function ghGraphqlFetch(query: string, variables: Record<string, unknown>, token: string): Promise<Response> {
  return fetch('https://api.github.com/graphql', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: 'application/vnd.github+json',
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ query, variables }),
  });
}

// ── Auth / device flow ────────────────────────────────────────────────────────

export async function deviceFlowStart(): Promise<DeviceCodeResponse> {
  const res = await ghFormFetch('https://github.com/login/device/code', {
    client_id: GITHUB_CLIENT_ID,
    scope: 'read:user user:email repo',
  });
  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw new Error(`GitHub device flow start failed: ${res.status}${body ? ` — ${body}` : ''}`);
  }
  const data = await res.json() as {
    device_code: string;
    user_code: string;
    verification_uri: string;
    expires_in: number;
    interval: number;
  };
  return {
    deviceCode: data.device_code,
    userCode: data.user_code,
    verificationUri: data.verification_uri,
    expiresIn: data.expires_in,
    interval: data.interval,
  };
}

/**
 * Poll GitHub for the access token.
 * Returns the access token + username on success, or a status/error for
 * pending / expired / error states. Token storage is left to the caller
 * (the Electron main process handles safeStorage encryption).
 */
export async function deviceFlowPoll(
  deviceCode: string,
): Promise<GitHubPollResult & { accessToken: string | null; username: string | null }> {
  const res = await ghFormFetch('https://github.com/login/oauth/access_token', {
    client_id: GITHUB_CLIENT_ID,
    device_code: deviceCode,
    grant_type: 'urn:ietf:params:oauth:grant-type:device_code',
  });
  if (!res.ok) {
    return { status: 'error', accessToken: null, username: null, error: `HTTP ${res.status}` };
  }
  const data = await res.json() as { access_token?: string; error?: string };

  if (data.error === 'authorization_pending' || data.error === 'slow_down') {
    return { status: 'pending', accessToken: null, username: null, error: null };
  }
  if (data.error === 'expired_token') {
    return { status: 'expired', accessToken: null, username: null, error: null };
  }
  if (data.error) {
    return { status: 'error', accessToken: null, username: null, error: data.error };
  }
  if (!data.access_token) {
    return { status: 'pending', accessToken: null, username: null, error: null };
  }

  const username = await getUsername(data.access_token);
  return { status: 'complete', accessToken: data.access_token, username, error: null };
}

// ── API calls ─────────────────────────────────────────────────────────────────

export async function getUsername(token: string): Promise<string | null> {
  const res = await ghApiFetch('/user', token);
  if (!res.ok) return null;
  const user = await res.json() as { login: string };
  return user.login ?? null;
}

export async function listEmails(token: string): Promise<GitHubEmailSuggestion[]> {
  const res = await ghApiFetch('/user/emails', token);
  if (!res.ok) return [];
  const emails = await res.json() as Array<{
    email: string;
    primary: boolean;
    verified: boolean;
  }>;
  return emails.map(e => ({
    label: e.email,
    email: e.email,
    kind: e.primary ? 'primary' : 'secondary',
    primary: e.primary,
    verified: e.verified,
  }));
}

export async function listRepos(token: string): Promise<GitHubRepo[]> {
  const repos: GitHubRepo[] = [];
  let page = 1;
  while (true) {
    const res = await ghApiFetch(`/user/repos?per_page=100&sort=pushed&page=${page}`, token);
    if (!res.ok) break;
    const batch = await res.json() as Array<{
      full_name: string;
      clone_url: string;
      private: boolean;
      description: string | null;
    }>;
    if (batch.length === 0) break;
    for (const r of batch) {
      repos.push({
        fullName: r.full_name,
        cloneUrl: r.clone_url,
        private: r.private,
        description: r.description,
      });
    }
    if (batch.length < 100) break;
    page++;
  }
  return repos;
}

// ── Issue tracking ───────────────────────────────────────────────────────────

/** Parses a `github.com/{owner}/{repo}/issues|pull/{number}` URL. Returns null for anything else. */
export function parseGithubIssueUrl(url: string): { owner: string; repo: string; issueNumber: number } | null {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return null;
  }
  if (parsed.hostname !== 'github.com') return null;

  const match = /^\/([^/]+)\/([^/]+)\/(?:issues|pull)\/(\d+)/.exec(parsed.pathname);
  if (!match) return null;
  const [, owner, repo, issueNumber] = match;
  if (!owner || !repo || !issueNumber) return null;
  return { owner, repo, issueNumber: Number(issueNumber) };
}

/**
 * Fetches an issue or PR's title/description/state from GitHub's Issues API
 * (which also serves PRs). Best-effort: returns null on any failure rather
 * than throwing, since this is enrichment, not a critical path.
 */
export async function fetchGithubIssue(url: string, token: string): Promise<ProviderIssue | null> {
  const parsedUrl = parseGithubIssueUrl(url);
  if (!parsedUrl) return null;

  const res = await ghApiFetch(`/repos/${parsedUrl.owner}/${parsedUrl.repo}/issues/${parsedUrl.issueNumber}`, token);
  if (!res.ok) return null;

  const issue = await res.json() as { title: string; body: string | null; html_url: string; state: string };
  return {
    id: String(parsedUrl.issueNumber),
    title: issue.title,
    description: issue.body,
    url: issue.html_url,
    state: issue.state === 'open' || issue.state === 'closed' ? issue.state : 'unknown',
  };
}

// ── Pull requests ─────────────────────────────────────────────────────────────

type RawPullRequest = {
  number: number;
  node_id: string;
  html_url: string;
  title: string;
  state: string;
  draft: boolean;
  head: { ref: string };
  base: { ref: string };
  merged_at: string | null;
};

function mapPullRequest(pr: RawPullRequest): PullRequestInfo {
  return {
    number: pr.number,
    nodeId: pr.node_id,
    url: pr.html_url,
    title: pr.title,
    state: pr.merged_at ? 'merged' : pr.state === 'closed' ? 'closed' : 'open',
    draft: pr.draft,
    headBranch: pr.head.ref,
    baseBranch: pr.base.ref,
  };
}

/** Parses a git remote URL (`https://` or `git@` scp-like form) into a GitHub owner/repo. Returns null for non-GitHub remotes. */
export function parseGithubRemoteUrl(remoteUrl: string): { owner: string; repo: string } | null {
  const trimmed = remoteUrl.trim();
  const scpMatch = /^git@([^:]+):(.+)$/.exec(trimmed);
  const normalized = scpMatch ? `ssh://git@${scpMatch[1]}/${scpMatch[2]}` : trimmed;

  let parsed: URL;
  try {
    parsed = new URL(normalized);
  } catch {
    return null;
  }
  if (parsed.hostname !== 'github.com') return null;

  const parts = parsed.pathname.replace(/^\//, '').replace(/\.git$/, '').split('/');
  if (parts.length < 2 || !parts[0] || !parts[1]) return null;
  return { owner: parts[0], repo: parts[1] };
}

/**
 * Finds the most recently updated PR (of any state) whose head is `branch`.
 * Returns null if there isn't one, or on any API failure.
 */
export async function findPullRequestForBranch(
  owner: string,
  repo: string,
  branch: string,
  token: string,
): Promise<PullRequestInfo | null> {
  const endpoint = `/repos/${owner}/${repo}/pulls?head=${owner}:${encodeURIComponent(branch)}&state=all&sort=updated&direction=desc&per_page=1`;
  try {
    const res = await ghApiFetch(endpoint, token);
    if (!res.ok) return null;
    const prs = await res.json() as RawPullRequest[];
    const pr = prs[0];
    return pr ? mapPullRequest(pr) : null;
  } catch {
    return null;
  }
}

/**
 * Combines GitHub's combined-status API (classic statuses) and the
 * check-runs API (GitHub Actions/Checks) into a single state, since a repo
 * may use either or both. "failing" wins over "pending", which wins over
 * "passing"; "none" means no checks were found on either API.
 */
export async function getCombinedCheckState(
  owner: string,
  repo: string,
  ref: string,
  token: string,
): Promise<ChecksState> {
  try {
    const [statusRes, checkRunsRes] = await Promise.all([
      ghApiFetch(`/repos/${owner}/${repo}/commits/${encodeURIComponent(ref)}/status`, token),
      ghApiFetch(`/repos/${owner}/${repo}/commits/${encodeURIComponent(ref)}/check-runs`, token),
    ]);

    let hasAny = false;
    let hasFailure = false;
    let hasPending = false;

    if (statusRes.ok) {
      const status = await statusRes.json() as { state: string; statuses: unknown[] };
      if (status.statuses.length > 0) {
        hasAny = true;
        if (status.state === 'failure' || status.state === 'error') hasFailure = true;
        else if (status.state === 'pending') hasPending = true;
      }
    }

    if (checkRunsRes.ok) {
      const data = await checkRunsRes.json() as {
        check_runs: Array<{ status: string; conclusion: string | null }>;
      };
      if (data.check_runs.length > 0) {
        hasAny = true;
        const failingConclusions = new Set(['failure', 'timed_out', 'cancelled', 'action_required']);
        for (const run of data.check_runs) {
          if (run.status !== 'completed') hasPending = true;
          else if (run.conclusion && failingConclusions.has(run.conclusion)) hasFailure = true;
        }
      }
    }

    if (!hasAny) return 'none';
    if (hasFailure) return 'failing';
    if (hasPending) return 'pending';
    return 'passing';
  } catch {
    return 'none';
  }
}

/**
 * Fetches the per-check breakdown for `ref`, covering both the Checks API
 * (GitHub Actions and other check-run producers) and the legacy commit-statuses
 * API. Unlike `getCombinedCheckState`, callers get the individual name/status/
 * conclusion/details-url for every check rather than one rolled-up state.
 * Best-effort: returns an empty list on any failure.
 */
export async function getPullRequestChecks(
  owner: string,
  repo: string,
  ref: string,
  token: string,
): Promise<PullRequestCheck[]> {
  try {
    const [statusRes, checkRunsRes] = await Promise.all([
      ghApiFetch(`/repos/${owner}/${repo}/commits/${encodeURIComponent(ref)}/status`, token),
      ghApiFetch(`/repos/${owner}/${repo}/commits/${encodeURIComponent(ref)}/check-runs`, token),
    ]);

    const checks: PullRequestCheck[] = [];

    if (statusRes.ok) {
      const data = await statusRes.json() as {
        statuses: Array<{ id: number; context: string; state: string; target_url: string | null }>;
      };
      for (const s of data.statuses) {
        checks.push({
          id: `status:${s.id}`,
          name: s.context,
          source: 'status',
          status: s.state === 'pending' ? 'in_progress' : 'completed',
          conclusion: s.state === 'pending' ? null : s.state,
          detailsUrl: s.target_url,
        });
      }
    }

    if (checkRunsRes.ok) {
      const data = await checkRunsRes.json() as {
        check_runs: Array<{
          id: number;
          name: string;
          status: string;
          conclusion: string | null;
          details_url: string | null;
          html_url: string | null;
        }>;
      };
      for (const run of data.check_runs) {
        checks.push({
          id: `check_run:${run.id}`,
          name: run.name,
          source: 'check_run',
          status: run.status === 'queued' || run.status === 'in_progress' ? run.status : 'completed',
          conclusion: run.conclusion,
          detailsUrl: run.details_url ?? run.html_url,
        });
      }
    }

    return checks;
  } catch {
    return [];
  }
}

/** Looks up the open/most-recent PR for `branch` plus its combined check state and per-check breakdown. */
export async function getPullRequestStatus(
  owner: string,
  repo: string,
  branch: string,
  token: string,
): Promise<PullRequestStatus> {
  const pullRequest = await findPullRequestForBranch(owner, repo, branch, token);
  if (!pullRequest) return { pullRequest: null, checksState: 'none', checks: [] };
  const [checksState, checks] = await Promise.all([
    getCombinedCheckState(owner, repo, pullRequest.headBranch, token),
    getPullRequestChecks(owner, repo, pullRequest.headBranch, token),
  ]);
  return { pullRequest, checksState, checks };
}

/**
 * Fetches the failure summary/log excerpt + annotations for one check run.
 * `checkId` is a `PullRequestCheck.id` — only `check_run:<id>` ids have
 * failure detail (legacy commit statuses carry no log output), so this
 * returns null for a `status:<id>` id or any API failure.
 */
export async function getCheckFailureDetail(
  owner: string,
  repo: string,
  checkId: string,
  token: string,
): Promise<CheckFailureDetail | null> {
  const [source, rawId] = checkId.split(':');
  if (source !== 'check_run' || !rawId) return null;

  try {
    const [runRes, annotationsRes] = await Promise.all([
      ghApiFetch(`/repos/${owner}/${repo}/check-runs/${rawId}`, token),
      ghApiFetch(`/repos/${owner}/${repo}/check-runs/${rawId}/annotations`, token),
    ]);
    if (!runRes.ok) return null;

    const run = await runRes.json() as {
      name: string;
      output: { summary: string | null; text: string | null } | null;
    };
    const annotations = annotationsRes.ok
      ? (await annotationsRes.json() as Array<{
          path: string;
          start_line: number;
          end_line: number;
          annotation_level: string;
          message: string;
          title: string | null;
        }>).map(a => ({
          path: a.path,
          startLine: a.start_line,
          endLine: a.end_line,
          annotationLevel: a.annotation_level,
          message: a.message,
          title: a.title,
        }))
      : [];

    return {
      name: run.name,
      summary: run.output?.summary ?? null,
      text: run.output?.text ?? null,
      annotations,
    };
  } catch {
    return null;
  }
}

/**
 * Flips a PR between draft and ready-for-review. GitHub's REST API has no
 * field for this (the PATCH pulls endpoint doesn't accept `draft`), so this
 * goes through the GraphQL mutations `markPullRequestReadyForReview` /
 * `convertPullRequestToDraft`, keyed by the PR's GraphQL node id.
 */
export async function setPullRequestReadyForReview(
  nodeId: string,
  ready: boolean,
  token: string,
): Promise<void> {
  const mutation = ready
    ? `mutation($id: ID!) { markPullRequestReadyForReview(input: { pullRequestId: $id }) { pullRequest { id } } }`
    : `mutation($id: ID!) { convertPullRequestToDraft(input: { pullRequestId: $id }) { pullRequest { id } } }`;

  const res = await ghGraphqlFetch(mutation, { id: nodeId }, token);
  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw new Error(`GitHub ${ready ? 'ready for review' : 'convert to draft'} failed: ${res.status}${body ? ` — ${body}` : ''}`);
  }
  const data = await res.json() as { errors?: Array<{ message: string }> };
  if (data.errors?.length) {
    throw new Error(`GitHub ${ready ? 'ready for review' : 'convert to draft'} failed: ${data.errors.map(e => e.message).join('; ')}`);
  }
}

/** Merges a PR using the given method. Throws on any API failure (including a merge conflict, which GitHub reports as a 405/409 with a message). */
export async function mergePullRequest(
  owner: string,
  repo: string,
  pullNumber: number,
  method: MergeMethod,
  token: string,
): Promise<MergePullRequestResult> {
  const res = await ghApiPut(`/repos/${owner}/${repo}/pulls/${pullNumber}/merge`, token, {
    merge_method: method,
  });
  const data = await res.json().catch(() => ({})) as { merged?: boolean; message?: string };
  if (!res.ok) {
    throw new Error(`GitHub merge PR failed: ${res.status}${data.message ? ` — ${data.message}` : ''}`);
  }
  return { merged: data.merged ?? false, message: data.message ?? '' };
}

/** Creates a PR from `input.head` into `input.base`. Throws on any API failure. */
export async function createPullRequest(input: CreatePullRequestInput, token: string): Promise<PullRequestInfo> {
  const res = await ghApiPost(`/repos/${input.owner}/${input.repo}/pulls`, token, {
    title: input.title,
    body: input.body ?? '',
    head: input.head,
    base: input.base,
    draft: input.draft ?? false,
  });
  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw new Error(`GitHub create PR failed: ${res.status}${body ? ` — ${body}` : ''}`);
  }
  const pr = await res.json() as RawPullRequest;
  return mapPullRequest(pr);
}
