/**
 * Reactive path utilities for user-facing path labels.
 *
 * On macOS and Linux, `tildify()` replaces the home-directory prefix of an
 * absolute path with `~`. On Windows the path is returned unchanged.
 */
import { homeDir } from '@tauri-apps/api/path';

const IS_WINDOWS = typeof navigator !== 'undefined' && /windows/i.test(navigator.userAgent);

let _home = $state('');

if (typeof window !== 'undefined' && !IS_WINDOWS) {
  homeDir()
    .then(h => {
      // Normalise: ensure no trailing separator
      _home = h.endsWith('/') ? h.slice(0, -1) : h;
    })
    .catch(() => {
      // Non-fatal: leave _home empty so tildify falls back to the raw path
    });
}

/**
 * Returns a display-friendly version of `path` by replacing the user's home
 * directory prefix with `~` (macOS / Linux only).
 *
 * Examples (macOS, home = "/Users/alice"):
 *   "/Users/alice"                → "~"
 *   "/Users/alice/Projects/foo"   → "~/Projects/foo"
 *   "/tmp/other"                  → "/tmp/other"
 */
export function tildify(path: string): string {
  if (!_home || !path) return path;
  if (path === _home) return '~';
  if (path.startsWith(`${_home}/`)) return `~${path.slice(_home.length)}`;
  return path;
}
