import { afterEach, describe, expect, it, vi } from 'vitest';

const ORIGINAL_FETCH = globalThis.fetch;

afterEach(() => {
  if (ORIGINAL_FETCH) {
    globalThis.fetch = ORIGINAL_FETCH;
  } else {
    // eslint-disable-next-line @typescript-eslint/no-dynamic-delete
    delete (globalThis as { fetch?: typeof fetch }).fetch;
  }
  vi.restoreAllMocks();
});

describe('loadReleaseNotesBetween', () => {
  it('includes the target version and excludes the current version', async () => {
    const mockedReleases = [
      { tag_name: 'v0.4.0', body: 'target release notes', draft: false },
      { tag_name: 'v0.3.0', body: 'intermediate release notes', draft: false },
      { tag_name: 'v0.2.0', body: 'current release notes', draft: false },
      { tag_name: 'v0.1.0', body: 'older release notes', draft: false },
    ];

    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => mockedReleases,
    });
    vi.stubGlobal('fetch', fetchMock);

    const { loadReleaseNotesBetween } = await import('$lib/update.svelte');
    const notes = await loadReleaseNotesBetween('0.2.0', '0.4.0');

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(notes).toContain('v0.4.0');
    expect(notes).toContain('target release notes');
    expect(notes).toContain('v0.3.0');
    expect(notes).toContain('intermediate release notes');
    expect(notes).not.toContain('v0.2.0');
    expect(notes).not.toContain('current release notes');
    expect(notes).not.toContain('v0.1.0');
  });

  it('returns null when current and target versions are the same', async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);

    const { loadReleaseNotesBetween } = await import('$lib/update.svelte');
    const notes = await loadReleaseNotesBetween('0.4.0', '0.4.0');

    expect(notes).toBeNull();
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
