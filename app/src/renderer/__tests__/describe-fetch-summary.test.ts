import { describe, it, expect, vi } from 'vitest';
import type { FetchSummary } from '@sproutgit/types';

vi.mock('../api.js', () => ({ api: {} }));

import { describeFetchSummary } from '../queries.js';

function summary(overrides: Partial<FetchSummary>): FetchSummary {
  return {
    worktreePath: '/some/worktree',
    hadNoRemotes: false,
    updatedRefCount: 0,
    prunedRefCount: 0,
    ...overrides,
  };
}

// Regression coverage for "Fetch doesn't appear to do anything": a resolved
// fetch used to always show a generic "Fetched" toast, indistinguishable
// from a no-op whether there were no remotes, nothing new, or real updates.
describe('describeFetchSummary', () => {
  it('reports no remotes configured distinctly', () => {
    expect(describeFetchSummary(summary({ hadNoRemotes: true }))).toBe(
      'No remotes configured — nothing to fetch',
    );
  });

  it('reports already up to date when nothing changed', () => {
    expect(describeFetchSummary(summary({}))).toBe('Already up to date');
  });

  it('reports a single updated ref in singular form', () => {
    expect(describeFetchSummary(summary({ updatedRefCount: 1 }))).toBe('Fetched — 1 ref updated');
  });

  it('reports multiple updated refs in plural form', () => {
    expect(describeFetchSummary(summary({ updatedRefCount: 3 }))).toBe('Fetched — 3 refs updated');
  });

  it('reports pruned refs', () => {
    expect(describeFetchSummary(summary({ prunedRefCount: 2 }))).toBe('Fetched — 2 stale refs pruned');
  });

  it('reports both updated and pruned refs together', () => {
    expect(describeFetchSummary(summary({ updatedRefCount: 1, prunedRefCount: 1 }))).toBe(
      'Fetched — 1 ref updated, 1 stale ref pruned',
    );
  });
});
