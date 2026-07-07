/**
 * The invocation mode for the configured AI agent.
 * - `terminal`: spawned as a raw PTY session in a Terminal tab (works for any CLI).
 * - `integrated`: spawned in Agent Client Protocol (ACP) mode and rendered as
 *   a chat UI in the Chat tab. Only offered when the configured command is
 *   recognized as supporting ACP mode — see `commandSupportsIntegratedMode`.
 */
export type AgentInvocationMode = 'integrated' | 'terminal';

/**
 * Legacy shape of the (pre-roster) single configured AI agent — command +
 * args, same shape as the editor/diff-tool/merge-tool settings rows. Kept
 * only so the database layer can recognize and migrate a value stored under
 * this shape into the roster on first read after upgrading; nothing new
 * should be written in this shape.
 */
export type AgentConfig = {
  command: string;
  args: string[];
  mode: AgentInvocationMode;
};

/**
 * One named agent in the user's roster — command + args + per-agent
 * environment variables (API keys, base URLs, etc. without polluting the
 * global environment), plus an explicit `acp` flag: the user's own assertion
 * that this command speaks Agent Client Protocol, rather than the command
 * having to match the hardcoded `ACP_PRESET_TOKENS` allowlist. Recognized
 * presets still default `acp` to `true` when added via a quick-add button
 * (see `commandSupportsIntegratedMode`), but any command can be flagged this
 * way — obscure or internal ACP-speaking CLIs included.
 */
export type AgentRosterEntry = {
  id: string;
  name: string;
  command: string;
  args: string[];
  env: Record<string, string>;
  mode: AgentInvocationMode;
  /** User-asserted: does this command speak Agent Client Protocol? Gates Integrated mode alongside `commandSupportsIntegratedMode`. */
  acp: boolean;
};

/** The user's full set of configured coding agents, plus which one is used by default (agent:launch / chat:start when no agentId is specified). */
export type AgentRoster = {
  agents: AgentRosterEntry[];
  defaultAgentId: string;
};

/** Minimal fields needed to run agent:test against unsaved edits in the Settings UI, before the entry is saved to the roster. */
export type AgentTestInput = {
  name?: string;
  command: string;
  args: string[];
  env?: Record<string, string>;
  acp: boolean;
};

/** Agent name/version/capabilities reported back by a real ACP `initialize` handshake (agent:test, for acp-flagged agents). */
export type AcpHandshakeInfo = {
  name: string;
  version?: string;
  capabilities: string[];
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

/**
 * The recognized command-basename tokens for each ACP-capable preset — the
 * single source of truth for "is this command ACP-capable". The main
 * process's per-preset invocation table (app/src/main/ipc/agents.ts) and the
 * renderer's Settings UI (which can't import main-process code across the
 * IPC boundary) both derive their token matching from this list, so they
 * can't drift out of sync with each other.
 */
export const ACP_PRESET_TOKENS = {
  claudeCode: ['claude', 'claude-code'],
  gemini: ['gemini'],
  codex: ['codex'],
  kiro: ['kiro', 'kiro-cli'],
  cursor: ['cursor-agent'],
} satisfies Record<string, readonly string[]>;

/** Flattened set of every token recognized by any ACP preset above. */
export const ACP_CAPABLE_TOKENS: readonly string[] = Object.values(ACP_PRESET_TOKENS).flat();
