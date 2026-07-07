export type DeviceCodeResponse = {
  deviceCode: string;
  userCode: string;
  verificationUri: string;
  expiresIn: number;
  interval: number;
};

export type GitHubPollResult = {
  status: 'pending' | 'complete' | 'expired' | 'error';
  username: string | null;
  error: string | null;
};

export type GitHubAuthStatus = {
  authenticated: boolean;
  username: string | null;
  provider: string;
};

export type GitHubRepo = {
  fullName: string;
  cloneUrl: string;
  private: boolean;
  description: string | null;
};

export type GitHubEmailSuggestion = {
  label: string;
  email: string;
  kind: string;
  primary: boolean;
  verified: boolean;
};

export type PullRequestState = 'open' | 'closed' | 'merged';

export type ChecksState = 'passing' | 'failing' | 'pending' | 'none';

export type PullRequestInfo = {
  number: number;
  /** GraphQL node id — required for the ready-for-review/draft mutations, which have no REST equivalent. */
  nodeId: string;
  url: string;
  title: string;
  state: PullRequestState;
  draft: boolean;
  headBranch: string;
  baseBranch: string;
};

/** One check result on a PR's head commit, from either the Checks API (GitHub Actions etc.) or the legacy commit-statuses API. */
export type PullRequestCheck = {
  /** `check_run:<id>` or `status:<id>` — unique within one PR's check list. */
  id: string;
  name: string;
  source: 'check_run' | 'status';
  status: 'queued' | 'in_progress' | 'completed';
  /** e.g. success/failure/neutral/cancelled/timed_out/action_required/skipped/stale, or the legacy status's error/failure/pending/success. Null while not yet completed. */
  conclusion: string | null;
  detailsUrl: string | null;
};

export type PullRequestStatus = {
  pullRequest: PullRequestInfo | null;
  checksState: ChecksState;
  checks: PullRequestCheck[];
};

export type CreatePullRequestInput = {
  owner: string;
  repo: string;
  head: string;
  base: string;
  title: string;
  body?: string;
  draft?: boolean;
};

/** A single annotation (inline log excerpt) attached to a failing check run. */
export type CheckAnnotation = {
  path: string;
  startLine: number;
  endLine: number;
  annotationLevel: string;
  message: string;
  title: string | null;
};

/** Failure summary/log excerpt + annotations for one check run — only available for `check_run`-sourced checks, since legacy commit statuses carry no log detail. */
export type CheckFailureDetail = {
  name: string;
  summary: string | null;
  text: string | null;
  annotations: CheckAnnotation[];
};

export type MergeMethod = 'merge' | 'squash' | 'rebase';

export type MergePullRequestResult = {
  merged: boolean;
  message: string;
};

/** Per-workspace policy gating agent-initiated (MCP) ready-for-review/merge actions. Enforcement lands with the MCP tool exposure (#145) — for now this is read/write plumbing only. */
export type AgentPrPermission = 'auto' | 'ask' | 'never';
