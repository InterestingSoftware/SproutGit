import { useEffect, useState } from "react";
import { api } from "../api.js";
import { reportError } from "../error-reporting.js";
import type { AgentRoster, AgentRosterEntry } from "@sproutgit/types";

/** Loads the agent roster (Settings → AI Agents) once on mount and resolves the default agent. */
export function useAgentConfig() {
  const [agentRoster, setAgentRoster] = useState<AgentRoster | null>(null);

  useEffect(() => {
    // A failure here leaves the Chat tab looking unconfigured with no
    // indication why — surface it instead.
    void api
      .getAgentRoster()
      .then(setAgentRoster)
      .catch((err: unknown) =>
        reportError("Failed to load agent configuration", err),
      );
  }, []);

  const agentConfig: AgentRosterEntry | null = agentRoster
    ? (agentRoster.agents.find((a) => a.id === agentRoster.defaultAgentId) ??
      agentRoster.agents[0] ??
      null)
    : null;

  const agentConfigured = !!agentConfig?.command.trim();

  return { agentRoster, agentConfig, agentConfigured };
}
