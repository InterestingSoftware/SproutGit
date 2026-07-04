/**
 * The invocation mode for the configured AI agent.
 * - `terminal`: spawned as a raw PTY session in a Terminal tab (works for any CLI).
 * - `integrated`: spawned with structured streaming output and rendered as a
 *   chat UI in the Chat tab. Only offered when the configured command is
 *   recognized as supporting structured streaming output (currently: Claude Code).
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
