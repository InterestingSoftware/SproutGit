import { useEffect, useState } from "react";
import { api } from "../api.js";
import { consumePendingScaffold } from "../pending-scaffold.js";
import { useWorkspaceStore } from "../stores/workspace-store.js";
import type { AgentConfig, WorktreeInfo } from "@sproutgit/types";
import type { ToastFn } from "../toast-context.js";

/**
 * Scaffold kickoff for a project just created from the homescreen's "New
 * from idea" flow — see pending-scaffold.ts. Keyed by workspacePath (not the
 * worktree path — git reports that back through its own realpath resolution,
 * e.g. macOS's /var → /private/var, which would never match the
 * locally-constructed path the dialog stored it under). Consumed at most once
 * per workspace: harmless to re-run this effect (e.g. on a worktrees
 * refetch), since consumePendingScaffold() returns undefined thereafter.
 */
export function useScaffoldKickoff(params: {
  activeWorktree: WorktreeInfo | null;
  agentConfig: AgentConfig | null;
  workspacePath: string;
  toast: ToastFn;
}) {
  const { activeWorktree, agentConfig, workspacePath, toast } = params;
  const [chatAutoPrompt, setChatAutoPrompt] = useState<string | undefined>(
    undefined,
  );

  useEffect(() => {
    if (!activeWorktree || !agentConfig) return;
    const prompt = consumePendingScaffold(workspacePath);
    if (!prompt) return;
    if (agentConfig.mode === "integrated") {
      setChatAutoPrompt(prompt);
      useWorkspaceStore.setState({ activeTab: "chat" });
      return;
    }
    void (async () => {
      try {
        const terminalId = await api.launchAgent({
          workspacePath,
          worktreePath: activeWorktree.path,
        });
        // Give the CLI a moment to boot before "typing" the kickoff prompt.
        setTimeout(() => {
          void api
            .writeTerminal(terminalId, `${prompt}\n`)
            .catch(() => undefined);
        }, 1500);
      } catch (err) {
        toast(
          `Failed to launch agent for scaffolding: ${String(err)}`,
          "error",
        );
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeWorktree, agentConfig, workspacePath]);

  return chatAutoPrompt;
}
