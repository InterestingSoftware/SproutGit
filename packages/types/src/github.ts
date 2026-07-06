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
  url: string;
  title: string;
  state: PullRequestState;
  draft: boolean;
  headBranch: string;
  baseBranch: string;
};

export type PullRequestStatus = {
  pullRequest: PullRequestInfo | null;
  checksState: ChecksState;
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
