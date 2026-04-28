import { describe, it, expect, vi, beforeEach } from 'vitest';

// ── Mock Tauri path API before importing the module ──────────────────────────
vi.mock('@tauri-apps/api/path', () => ({
  homeDir: vi.fn().mockResolvedValue('/home/alice'),
}));

// ── Dynamic import so the mock is in place when the module initialises ───────
const { tildify } = await import('$lib/paths.svelte');

// Wait for the homeDir() promise to resolve and _home to be set
await new Promise(resolve => setTimeout(resolve, 0));

// ─────────────────────────────────────────────────────────────────────────────

describe('tildify', () => {
  it('replaces home directory prefix with ~', () => {
    expect(tildify('/home/alice/Projects/foo')).toBe('~/Projects/foo');
  });

  it('returns exactly ~ when path equals the home directory', () => {
    expect(tildify('/home/alice')).toBe('~');
  });

  it('does not modify paths outside the home directory', () => {
    expect(tildify('/tmp/other')).toBe('/tmp/other');
    expect(tildify('/var/log/syslog')).toBe('/var/log/syslog');
  });

  it('does not double-tildify an already-tildified path', () => {
    // ~/foo is not an absolute path starting with /home/alice, so untouched
    expect(tildify('~/Projects/foo')).toBe('~/Projects/foo');
  });

  it('returns an empty string unchanged', () => {
    expect(tildify('')).toBe('');
  });

  it('does not match partial home prefix without a separator', () => {
    // /home/alicebob is a different user — should not be tildified
    expect(tildify('/home/alicebob/stuff')).toBe('/home/alicebob/stuff');
  });
});
