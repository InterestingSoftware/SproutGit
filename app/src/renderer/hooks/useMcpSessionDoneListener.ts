import { useEffect } from "react";
import { api } from "../api.js";
import type { ToastFn } from "../toast-context.js";

/** Toasts the `report_session_done` MCP tool call so a user with this workspace open sees when an external agent finishes a session. */
export function useMcpSessionDoneListener(toast: ToastFn) {
  useEffect(() => {
    const offMcpSessionDone = api.onMcpSessionDone((event) => {
      // Split on both separators — worktreePath comes from the main process
      // and may be a Windows path (backslash-separated).
      const name = event.worktreePath.split(/[/\\]/).pop() || event.worktreePath;
      toast(
        event.summary
          ? `${name}: ${event.summary}`
          : `Agent session finished in ${name}`,
        "success",
      );
    });

    return () => {
      offMcpSessionDone();
    };
  }, [toast]);
}
