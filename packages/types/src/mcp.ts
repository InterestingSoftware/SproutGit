/** MCP client configs SproutGit knows how to auto-write. */
export type McpClientId = 'claude' | 'gemini' | 'codex' | 'cursor' | 'kiro';

export type McpServerStatus = {
  /** Whether the socket/pipe server is currently listening for this workspace. */
  running: boolean;
  socketPath: string | null;
  /** Persisted per-workspace toggle — whether the server should auto-start when the workspace opens. */
  enabled: boolean;
};

export type McpConfigWriteResult = {
  /** Absolute path of the config file that was created or merged into. */
  configPath: string;
};
