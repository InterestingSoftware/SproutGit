/**
 * Validate a git branch name according to `git check-ref-format` rules.
 * Returns null if valid, or an error message string if invalid.
 *
 * Rules: https://git-scm.com/docs/git-check-ref-format
 */
export function validateBranchName(name: string): string | null {
  const trimmed = name.trim();

  if (!trimmed) {
    return 'Branch name is required.';
  }

  if (trimmed.startsWith('-')) {
    return 'Cannot start with a hyphen.';
  }

  if (trimmed.startsWith('.') || trimmed.includes('/.')) {
    return "Cannot start with a dot or contain '/.'.";
  }

  if (trimmed.endsWith('.')) {
    return 'Cannot end with a dot.';
  }

  if (trimmed.endsWith('/')) {
    return 'Cannot end with a slash.';
  }

  if (trimmed.includes('..')) {
    return "Cannot contain '..'.";
  }

  if (trimmed.includes('@{')) {
    return "Cannot contain '@{'.";
  }

  if (trimmed === '@') {
    return "Cannot be the single character '@'.";
  }

  if (trimmed.endsWith('.lock')) {
    return "Cannot end with '.lock'.";
  }

  if (trimmed.includes('\\')) {
    return 'Cannot contain backslash.';
  }

  // ASCII control characters (0x00-0x1F, 0x7F), space, tilde, caret, colon
  // eslint-disable-next-line no-control-regex
  if (/[\x00-\x1f\x7f ~^:]/.test(trimmed)) {
    return 'Cannot contain spaces or special characters (~, ^, :, control chars).';
  }

  // eslint-disable-next-line no-useless-escape
  if (/[?*\[]/.test(trimmed)) {
    return 'Cannot contain glob characters (?, *, [).';
  }

  if (trimmed.includes('//')) {
    return 'Cannot contain consecutive slashes.';
  }

  return null;
}

/**
 * Validate a source ref field (branch, tag, or commit hash).
 */
export function validateSourceRef(ref: string): string | null {
  const trimmed = ref.trim();
  if (!trimmed) {
    return 'Source ref is required.';
  }
  return null;
}

/**
 * Validate a commit message.
 * Returns null if valid, or an error message string if invalid.
 */
export function validateCommitMessage(message: string): string | null {
  const trimmed = message.trim();

  if (!trimmed) {
    return 'Commit message is required.';
  }

  // eslint-disable-next-line no-control-regex
  if (/[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]/.test(trimmed)) {
    return 'Commit message contains unsupported control characters.';
  }

  if (trimmed.length > 10_000) {
    return 'Commit message is too long (max 10,000 characters).';
  }

  return null;
}
