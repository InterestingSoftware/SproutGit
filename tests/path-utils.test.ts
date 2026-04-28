import { describe, it, expect, vi, afterEach } from 'vitest';

const ORIGINAL_NAVIGATOR = globalThis.navigator;

function setUserAgent(userAgent: string) {
  Object.defineProperty(globalThis, 'navigator', {
    value: { userAgent },
    configurable: true,
  });
}

async function loadFresh() {
  vi.resetModules();
  return await import('$lib/path-utils');
}

afterEach(() => {
  Object.defineProperty(globalThis, 'navigator', {
    value: ORIGINAL_NAVIGATOR,
    configurable: true,
  });
});

describe('path-utils', () => {
  describe('normalizePathSeparators', () => {
    it('converts backslashes to forward slashes', async () => {
      setUserAgent('Mozilla/5.0 (Linux)');
      const { normalizePathSeparators } = await loadFresh();
      expect(normalizePathSeparators('C:\\Users\\foo\\bar')).toBe('C:/Users/foo/bar');
    });

    it('leaves forward-slash paths unchanged', async () => {
      setUserAgent('Mozilla/5.0 (Linux)');
      const { normalizePathSeparators } = await loadFresh();
      expect(normalizePathSeparators('/home/runner/work/SproutGit/SproutGit')).toBe(
        '/home/runner/work/SproutGit/SproutGit'
      );
    });
  });

  describe('stripTrailingSeparator', () => {
    it('removes a single trailing separator', async () => {
      setUserAgent('Mozilla/5.0 (Linux)');
      const { stripTrailingSeparator } = await loadFresh();
      expect(stripTrailingSeparator('/foo/bar/')).toBe('/foo/bar');
      expect(stripTrailingSeparator('C:\\foo\\')).toBe('C:/foo');
    });

    it('preserves the root separator', async () => {
      setUserAgent('Mozilla/5.0 (Linux)');
      const { stripTrailingSeparator } = await loadFresh();
      expect(stripTrailingSeparator('/')).toBe('/');
    });
  });

  describe('pathKey', () => {
    it('lowercases on Windows', async () => {
      setUserAgent('Mozilla/5.0 (Windows NT 10.0)');
      const { pathKey } = await loadFresh();
      expect(pathKey('C:\\Users\\Foo')).toBe('c:/users/foo');
    });

    it('lowercases on macOS', async () => {
      setUserAgent('Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)');
      const { pathKey } = await loadFresh();
      expect(pathKey('/Users/Alice/Project')).toBe('/users/alice/project');
    });

    it('preserves case on Linux', async () => {
      setUserAgent('Mozilla/5.0 (X11; Linux x86_64)');
      const { pathKey } = await loadFresh();
      expect(pathKey('/home/runner/work/SproutGit/SproutGit')).toBe(
        '/home/runner/work/SproutGit/SproutGit'
      );
    });
  });

  describe('pathsEqual', () => {
    it('returns true for case-only differences on Windows', async () => {
      setUserAgent('Mozilla/5.0 (Windows NT 10.0)');
      const { pathsEqual } = await loadFresh();
      expect(pathsEqual('C:\\Users\\Foo', 'c:/users/foo')).toBe(true);
    });

    it('returns false for case-only differences on Linux', async () => {
      setUserAgent('Mozilla/5.0 (X11; Linux x86_64)');
      const { pathsEqual } = await loadFresh();
      expect(pathsEqual('/home/Runner/work', '/home/runner/work')).toBe(false);
    });

    it('returns true for identical paths on every platform', async () => {
      setUserAgent('Mozilla/5.0 (X11; Linux x86_64)');
      const { pathsEqual } = await loadFresh();
      expect(pathsEqual('/a/b/c', '/a/b/c')).toBe(true);
    });

    it('treats both nullish as equal and one nullish as unequal', async () => {
      setUserAgent('Mozilla/5.0 (Linux)');
      const { pathsEqual } = await loadFresh();
      expect(pathsEqual(null, null)).toBe(true);
      expect(pathsEqual(undefined, undefined)).toBe(true);
      expect(pathsEqual(null, '/foo')).toBe(false);
      expect(pathsEqual('/foo', undefined)).toBe(false);
    });
  });

  describe('pathStartsWith', () => {
    it('matches a directory prefix on Windows (case-insensitive)', async () => {
      setUserAgent('Mozilla/5.0 (Windows NT 10.0)');
      const { pathStartsWith } = await loadFresh();
      expect(pathStartsWith('C:\\Users\\foo', 'c:/users/FOO/projects/x')).toBe(true);
    });

    it('does not match prefixes that are not directory boundaries', async () => {
      setUserAgent('Mozilla/5.0 (Linux)');
      const { pathStartsWith } = await loadFresh();
      expect(pathStartsWith('/foo/bar', '/foo/barbaz')).toBe(false);
    });

    it('matches the path itself', async () => {
      setUserAgent('Mozilla/5.0 (Linux)');
      const { pathStartsWith } = await loadFresh();
      expect(pathStartsWith('/foo/bar', '/foo/bar')).toBe(true);
      expect(pathStartsWith('/foo/bar/', '/foo/bar')).toBe(true);
    });

    it('preserves Linux case-sensitivity', async () => {
      setUserAgent('Mozilla/5.0 (X11; Linux x86_64)');
      const { pathStartsWith } = await loadFresh();
      expect(pathStartsWith('/home/Runner', '/home/runner/work')).toBe(false);
    });
  });

  describe('findPath', () => {
    it('returns the original-case entry when looking up by lowercased path on Windows', async () => {
      setUserAgent('Mozilla/5.0 (Windows NT 10.0)');
      const { findPath } = await loadFresh();
      const items = [{ path: 'C:\\Users\\Alice\\repo' }, { path: 'C:\\Users\\Alice\\other' }];
      const match = findPath(items, item => item.path, 'c:/users/alice/repo');
      expect(match).not.toBeNull();
      expect(match?.path).toBe('C:\\Users\\Alice\\repo');
    });

    it('preserves case on Linux and returns null when case differs', async () => {
      setUserAgent('Mozilla/5.0 (X11; Linux x86_64)');
      const { findPath } = await loadFresh();
      const items = [{ path: '/home/runner/work/SproutGit/SproutGit' }];
      expect(
        findPath(items, item => item.path, '/home/runner/work/sproutgit/sproutgit')
      ).toBeNull();
      expect(
        findPath(items, item => item.path, '/home/runner/work/SproutGit/SproutGit')?.path
      ).toBe('/home/runner/work/SproutGit/SproutGit');
    });
  });
});
