/**
 * Validates a Git branch name against `git check-ref-format`-style rules.
 * Shared between the renderer (for inline form feedback) and the git package
 * (as the actual trust boundary before the name is used to build a filesystem
 * path or passed to `git`).
 *
 * Returns a human-readable error message, or `null` if the name is valid.
 */
export function validateBranchName(name: string): string | null {
  const t = name.trim();
  if (!t) return 'Branch name is required.';
  if (t.startsWith('-')) return 'Cannot start with a hyphen.';
  if (t.startsWith('.') || t.includes('/.')) return "Cannot start with a dot or contain '/.'.";
  if (t.endsWith('.')) return 'Cannot end with a dot.';
  if (t.endsWith('/')) return 'Cannot end with a slash.';
  if (t.includes('..')) return "Cannot contain '..'.";
  if (t.includes('@{')) return "Cannot contain '@{'.";
  if (t === '@') return "Cannot be '@'.";
  if (t.endsWith('.lock')) return "Cannot end with '.lock'.";
  if (t.includes('\\')) return 'Cannot contain backslash.';
  // eslint-disable-next-line no-control-regex
  if (/[\x00-\x1f\x7f ~^:]/.test(t)) return 'Cannot contain spaces or special chars.';
  if (/[?*[\]]/.test(t)) return 'Cannot contain glob chars.';
  if (t.includes('//')) return 'Cannot contain consecutive slashes.';
  return null;
}
