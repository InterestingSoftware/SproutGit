/** MCP client configs SproutGit knows how to auto-write. */
export type McpClientId = 'claude' | 'gemini' | 'codex' | 'cursor' | 'kiro';

export type McpServerStatus = {
  /** Whether the HTTP server is currently listening for this workspace. */
  running: boolean;
  /** Effective port (user override if set, otherwise a stable per-workspace default) — shown even when not running. */
  port: number;
  /** Persisted per-workspace toggle — whether the server should auto-start when the workspace opens. */
  enabled: boolean;
};

export type McpConfigWriteResult = {
  /** Absolute path of the config file that was created or merged into. */
  configPath: string;
};

/** Pushed to the renderer when an MCP client calls the `report_session_done` tool, so the UI can surface it (e.g. a toast). */
export type McpSessionDoneEvent = {
  /** Absolute path of the worktree the reporting agent was working in. */
  worktreePath: string;
  /** Optional free-text summary the agent provided of what it did. */
  summary: string | null;
};
