export type EditorInfo = {
  id: string;
  name: string;
  command: string;
  /** The actual invocable command — an absolute path when only found via a known .app bundle fallback (no CLI shim on PATH), otherwise same as `command`. Use this when writing git config so the configured value works without relying on PATH. */
  resolvedCommand: string;
  installed: boolean;
};

export type GitToolInfo = {
  id: string;
  name: string;
  command: string;
  /** See EditorInfo.resolvedCommand. */
  resolvedCommand: string;
  installed: boolean;
  supportsDiff: boolean;
  supportsMerge: boolean;
};

/**
 * Result of a real "Test" run for any settings row (editor, diff tool, merge
 * tool, AI agent, commit message generator, shell). Shown inline near the
 * row — there is more to report than a boolean, so `detail` carries the
 * resolved command and truncated stdout/stderr.
 */
export type ToolTestResult = {
  ok: boolean;
  /** The fully resolved command line that was actually run. */
  resolvedCommand: string;
  /** Human-readable summary, e.g. "Process launched (pid 1234)" or truncated stdout. */
  detail: string;
  /** Present only when ok is false. */
  error?: string;
};
