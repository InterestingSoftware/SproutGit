import { useEffect, useState } from "react";
import { api } from "../api.js";
import { reportError } from "../error-reporting.js";
import type { AgentConfig } from "@sproutgit/types";

/** Loads the configured coding agent (Settings → AI Agent) once on mount. */
export function useAgentConfig() {
  const [agentConfig, setAgentConfig] = useState<AgentConfig | null>(null);

  useEffect(() => {
    // A failure here leaves the Chat tab looking unconfigured with no
    // indication why — surface it instead.
    void api
      .getAgentConfig()
      .then(setAgentConfig)
      .catch((err: unknown) =>
        reportError("Failed to load agent configuration", err),
      );
  }, []);

  const agentConfigured = !!agentConfig?.command.trim();

  return { agentConfig, agentConfigured };
}
