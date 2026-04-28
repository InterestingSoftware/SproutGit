/**
 * Cross-platform filesystem path helpers for the SproutGit frontend.
 *
 * These helpers are the **single source of truth** for path normalisation and
 * comparison in the webview. They intentionally mirror the behaviour of the
 * Rust-side `path_to_frontend()` and `strip_win_prefix()` helpers in
 * `src-tauri/src/git/helpers.rs` so that paths flowing across the bridge
 * compare correctly on every supported platform (macOS, Linux, Windows).
 *
 * Always import from `$lib/path-utils` instead of:
 *   • calling `.toLowerCase()` on a path,
 *   • inlining `.replace(/\\/g, '/')` separator conversions,
 *   • or doing strict `===` comparisons on filesystem paths.
 *
 * Why this matters:
 *   • Linux is case-sensitive — lowercasing a real path produces a path that
 *     does not exist (e.g. `/home/runner/work/SproutGit/SproutGit/...` →
 *     `/home/runner/work/sproutgit/sproutgit/...`). Round-tripping such a path
 *     to the backend then fails with "Repository path does not exist".
 *   • Windows path canonicalisation may emit mixed-case drive letters or the
 *     `\\?\` extended-length prefix; the backend strips the prefix before
 *     returning paths, but case-only differences can still occur.
 *   • macOS APFS and Windows NTFS are case-insensitive **by default** (but not
 *     always); equality must therefore be case-insensitive on those OSes.
 *
 * Storage rule: never mutate the case of a path before storing it. Keep the
 * exact string returned by the backend, and only lowercase at the moment of
 * comparison via `pathsEqual()` / `pathKey()`.
 */

const _userAgent =
  typeof navigator !== 'undefined' && typeof navigator.userAgent === 'string'
    ? navigator.userAgent
    : '';

export const IS_WINDOWS = /windows/i.test(_userAgent);
export const IS_MACOS = /mac os x|macintosh/i.test(_userAgent) && !IS_WINDOWS;

/**
 * Default filesystem case-sensitivity for the current OS.
 *
 * Linux / *BSD: case-sensitive (most filesystems).
 * macOS APFS:   case-insensitive by default (case-sensitive APFS exists but is
 *               rare; treating it as case-insensitive matches user expectations
 *               and avoids breaking common workflows).
 * Windows NTFS: case-insensitive by default.
 */
export const PATH_CASE_INSENSITIVE = IS_WINDOWS || IS_MACOS;

/**
 * Convert all backslash separators to forward slashes.
 *
 * The Rust backend already returns forward-slash paths via `path_to_frontend()`,
 * but values coming from the OS-native file watcher, terminal `cwd`, or
 * synthesised fallback paths in the frontend may still contain backslashes on
 * Windows. Normalising here keeps a single canonical separator across the UI.
 */
export function normalizePathSeparators(path: string): string {
  return path.replace(/\\/g, '/');
}

/**
 * Strip a single trailing path separator (after separator normalisation).
 *
 * Use this before comparing path prefixes so `/foo` and `/foo/` are equivalent.
 */
export function stripTrailingSeparator(path: string): string {
  const norm = normalizePathSeparators(path);
  if (norm.length > 1 && norm.endsWith('/')) {
    return norm.slice(0, -1);
  }
  return norm;
}

/**
 * Canonical comparison key for a filesystem path.
 *
 * • Always normalises separators to `/`.
 * • Lowercases on case-insensitive platforms (Windows, macOS) only.
 *
 * Use this whenever you need to use a path as a `Map` / object key, deduplicate
 * a list of paths, or compute a `Set` of paths. Never persist the result back
 * into a field that is later used for I/O — keep the original-case path for
 * that.
 */
export function pathKey(path: string): string {
  const norm = normalizePathSeparators(path);
  return PATH_CASE_INSENSITIVE ? norm.toLowerCase() : norm;
}

/**
 * Case- and separator-aware filesystem path equality.
 *
 * Returns `true` when both arguments are nullish, `false` if exactly one is.
 */
export function pathsEqual(a: string | null | undefined, b: string | null | undefined): boolean {
  if (a == null || b == null) return a === b;
  return pathKey(a) === pathKey(b);
}

/**
 * Returns `true` when `child` is `parent` or is a path nested under `parent`.
 *
 * Honours the platform's filesystem case-sensitivity rules. The check is
 * separator-aware: `/foo/bar` is *not* a prefix of `/foo/barbaz`.
 */
export function pathStartsWith(parent: string, child: string): boolean {
  const p = stripTrailingSeparator(parent);
  const c = stripTrailingSeparator(child);
  if (pathsEqual(p, c)) return true;
  const pKey = pathKey(p);
  const cKey = pathKey(c);
  return cKey.startsWith(`${pKey}/`);
}

/**
 * Find a path within a list using filesystem-aware equality.
 *
 * Returns the **original** entry from `paths` (preserving its case), not the
 * lowercased comparison form. Useful for round-tripping a user-supplied or
 * persisted path back to the canonical on-disk path returned by the backend.
 */
export function findPath<T>(items: T[], getPath: (item: T) => string, target: string): T | null {
  const targetKey = pathKey(target);
  return items.find(item => pathKey(getPath(item)) === targetKey) ?? null;
}
