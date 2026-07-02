import type { ProviderId } from '@sproutgit/types';

/**
 * Maps a resolved issue URL's hostname to the provider that can enrich it.
 * Detection is by hostname (not a `type=` field in `.issuetracker`, which
 * doesn't exist in the real convention) so existing `.issuetracker` files
 * work unmodified — adding a provider later is one more table entry.
 */
const HOSTNAME_PROVIDERS: Record<string, ProviderId> = {
  'github.com': 'github',
};

export function detectProviderFromUrl(url: string): ProviderId | null {
  let hostname: string;
  try {
    hostname = new URL(url).hostname;
  } catch {
    return null;
  }
  return HOSTNAME_PROVIDERS[hostname] ?? null;
}
