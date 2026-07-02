import type { ProviderId, ProviderIssue } from '@sproutgit/types';
import { fetchGithubIssue } from '@sproutgit/provider-github';

type IssueTrackingCapability = {
  fetchIssue(url: string, token: string): Promise<ProviderIssue | null>;
};

/**
 * Capability registry: which provider handles which capability. Only GitHub
 * is implemented today (it's the only provider SproutGit already has OAuth
 * for) — adding another provider is an additional entry here plus one
 * hostname rule in `detect.ts`, not a redesign.
 */
const registry: Partial<Record<ProviderId, { issueTracking?: IssueTrackingCapability }>> = {
  github: {
    issueTracking: { fetchIssue: fetchGithubIssue },
  },
};

export function getIssueTrackingCapability(providerId: ProviderId): IssueTrackingCapability | null {
  return registry[providerId]?.issueTracking ?? null;
}
