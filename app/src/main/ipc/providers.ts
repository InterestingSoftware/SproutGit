import { IPC } from '@sproutgit/types';
import type { ProviderIssue } from '@sproutgit/types';
import { detectProviderFromUrl } from '../providers/detect.js';
import { getIssueTrackingCapability } from '../providers/registry.js';
import { getStoredGithubToken } from './github.js';
import { handle } from './handle.js';

export function registerProviderHandlers(userDataPath: string): void {
  handle(IPC.PROVIDER_FETCH_ISSUE, async (_e, url: string): Promise<ProviderIssue | null> => {
    const providerId = detectProviderFromUrl(url);
    if (!providerId) return null;

    const capability = getIssueTrackingCapability(providerId);
    if (!capability) return null;

    // Only GitHub is registered today, so this is the only credential we
    // look up — a future provider's capability entry would resolve its own.
    const cred = providerId === 'github' ? getStoredGithubToken(userDataPath) : null;
    if (!cred) return null;

    return capability.fetchIssue(url, cred.token);
  });
}
