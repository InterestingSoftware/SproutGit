import { realpathSync } from 'node:fs';
import { resolve, sep } from 'node:path';

/**
 * Resolves symlinks (e.g. macOS's /var → /private/var) so paths that refer
 * to the same directory compare equal even if one side went through a
 * symlinked temp dir and the other didn't. Falls back to a plain `resolve()`
 * for paths that don't exist (already-removed worktrees, races, etc).
 */
export function canonicalize(path: string): string {
  try {
    return realpathSync.native(path);
  } catch {
    return resolve(path);
  }
}

/**
 * True when `childPath` is `parentPath` itself or nested inside it, checked
 * on a path-separator boundary (so "worktrees-other" doesn't match
 * "worktrees"). Pure path comparison — no filesystem access, no symlink
 * resolution. Callers comparing paths that may have come through different
 * symlink states (e.g. one from git's own realpath-based reporting, one
 * constructed locally) should `canonicalize()` both sides first.
 */
export function isPathWithin(childPath: string, parentPath: string): boolean {
  const parent = resolve(parentPath);
  const child = resolve(childPath);
  return child === parent || child.startsWith(parent + sep);
}
