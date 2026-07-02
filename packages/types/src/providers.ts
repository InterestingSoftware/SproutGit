/**
 * Generic contract for pluggable external-service providers (issue trackers,
 * repo hosts, etc). Kept as an open string rather than a union so adding a
 * new provider doesn't require editing every consumer's type.
 */
export type ProviderId = string;

/**
 * `repoHosting` is documented here but not yet wired through the provider
 * registry — GitHub's existing repo-listing IPC is unaffected by this
 * abstraction until a second repo-hosting provider justifies unifying them.
 */
export type ProviderCapability = 'issueTracking' | 'repoHosting';

/** A fetched issue/PR, normalized across providers. */
export type ProviderIssue = {
  id: string;
  title: string;
  description: string | null;
  url: string;
  state: 'open' | 'closed' | 'unknown';
};
