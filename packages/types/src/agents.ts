/** A configured AI coding agent that can be launched in a worktree's terminal. */
export type CodingAgent = {
  id: string;
  name: string;
  command: string;
  args: string[];
};

/** The user's full agent roster, as stored under the `codingAgents` / `defaultAgentId` settings keys. */
export type AgentRoster = {
  agents: CodingAgent[];
  defaultAgentId: string | null;
};

/** Pushed to the renderer when an agent-launched PTY session is spawned, so it can be added as a terminal tab. */
export type AgentTerminalLaunchEvent = {
  terminalId: string;
  agentId: string;
  agentName: string;
  cwd: string;
};
