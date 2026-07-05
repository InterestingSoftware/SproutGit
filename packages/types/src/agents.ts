/**
 * The invocation mode for the configured AI agent.
 * - `terminal`: spawned as a raw PTY session in a Terminal tab (works for any CLI).
 * - `integrated`: spawned in Agent Client Protocol (ACP) mode and rendered as
 *   a chat UI in the Chat tab. Only offered when the configured command is
 *   recognized as supporting ACP mode — see `commandSupportsIntegratedMode`.
 */
export type AgentInvocationMode = 'integrated' | 'terminal';

/**
 * The user's single configured AI agent — command + args, same shape as the
 * editor/diff-tool/merge-tool settings rows. Only one agent is active at a
 * time; there is no roster.
 */
export type AgentConfig = {
  command: string;
  args: string[];
  mode: AgentInvocationMode;
};

/** Pushed to the renderer when an agent-launched PTY session is spawned, so it can be added as a terminal tab. */
export type AgentTerminalLaunchEvent = {
  terminalId: string;
  cwd: string;
};

/** A recognized agent CLI preset shown as a quick-pick button in Settings. */
export type AgentPreset = {
  id: string;
  name: string;
  command: string;
  args: string[];
  /** Whether this preset's command is recognized as supporting Integrated (structured streaming) mode. */
  supportsIntegrated: boolean;
};

/**
 * Whether the configured agent's ACP mode needs a separate adapter package
 * installed (e.g. Claude Code, Codex CLI) and, if so, whether it's already
 * resolvable (on PATH or previously installed by SproutGit itself).
 * `null` when the configured command doesn't use a separate adapter at all
 * (native ACP support via a flag/subcommand, e.g. Gemini/Kiro/Cursor).
 */
export type AcpAdapterStatus = {
  npmPackage: string;
  label: string;
  bin: string;
  installed: boolean;
  /** Rough download size, for the install button's confirmation copy. */
  approxSizeMb: number;
  /** Whether `npm` is resolvable on PATH — SproutGit's on-demand install shells out to it. */
  npmAvailable: boolean;
};

/** Pushed to the renderer while an ACP adapter install is in progress. */
export type AcpAdapterInstallEvent = {
  npmPackage: string;
  status: 'progress' | 'done' | 'error';
  message: string;
};
