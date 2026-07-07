import { useEffect, useState } from "react";
import { api } from "../api.js";
import { reportError } from "../error-reporting.js";
import type { SessionAttention } from "@sproutgit/types";

const AWAITING_STATES = new Set(["awaiting-permission", "awaiting-input"]);

/**
 * Loads and live-updates the attention state (working / awaiting-permission /
 * awaiting-input / finished / failed) of every tracked agent session — both
 * ACP chat sessions and PTY-launched agent terminals (see #140). Kept as a
 * flat `sessionId -> SessionAttention` map; callers derive per-worktree or
 * per-session views (AgentSessionsPanel, WorktreeSidebar, WorkspaceHeader).
 */
export function useSessionAttention() {
  const [bySessionId, setBySessionId] = useState<Record<string, SessionAttention>>({});

  useEffect(() => {
    let cancelled = false;
    void api
      .listSessionAttention()
      .then((list) => {
        if (cancelled) return;
        setBySessionId(Object.fromEntries(list.map((entry) => [entry.sessionId, entry])));
      })
      .catch((err: unknown) => reportError("Failed to load agent session attention state", err));

    const offChanged = api.onSessionAttentionChanged((entry) => {
      setBySessionId((prev) => ({ ...prev, [entry.sessionId]: entry }));
    });
    const offRemoved = api.onSessionAttentionRemoved((sessionId) => {
      setBySessionId((prev) => {
        if (!(sessionId in prev)) return prev;
        const next = { ...prev };
        delete next[sessionId];
        return next;
      });
    });

    return () => {
      cancelled = true;
      offChanged();
      offRemoved();
    };
  }, []);

  const attentions = Object.values(bySessionId);
  const byWorktreePath: Record<string, SessionAttention[]> = {};
  for (const entry of attentions) {
    (byWorktreePath[entry.worktreePath] ??= []).push(entry);
  }
  const waitingCount = attentions.filter((entry) => AWAITING_STATES.has(entry.state)).length;

  return { bySessionId, byWorktreePath, waitingCount };
}

/** Whether any entry for a worktree is in an "awaiting" state — used to decide whether to render the amber waiting badge. */
export function hasAwaitingAttention(entries: SessionAttention[] | undefined): boolean {
  return !!entries?.some((entry) => AWAITING_STATES.has(entry.state));
}
