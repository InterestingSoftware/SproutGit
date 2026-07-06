import { useEffect, useState } from "react";
import { useNavigate } from "@tanstack/react-router";
import { api } from "../api.js";
import type { RecentWorkspace } from "@sproutgit/types";

/** Recent-workspace list for the title bar's workspace switcher, plus switching itself. */
export function useRecentWorkspaces(workspacePath: string) {
  const navigate = useNavigate();
  const [recentWorkspaces, setRecentWorkspaces] = useState<RecentWorkspace[]>(
    [],
  );

  async function loadRecentWorkspaces(): Promise<RecentWorkspace[]> {
    try {
      const ws = await api.listRecentWorkspaces();
      const sorted = [...ws].sort(
        (a, b) =>
          new Date(b.lastOpenedAt).getTime() -
          new Date(a.lastOpenedAt).getTime(),
      );
      setRecentWorkspaces(sorted);
      return sorted;
    } catch {
      return recentWorkspaces;
    }
  }

  useEffect(() => {
    void loadRecentWorkspaces();
    // loadRecentWorkspaces is redefined every render (it closes over
    // recentWorkspaces for its error fallback) — only re-run on navigation.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [workspacePath]);

  function switchWorkspace(path: string) {
    if (path === workspacePath) return;
    void api.addRecentWorkspace(path);
    void navigate({ to: "/workspace", search: { path } });
  }

  return { recentWorkspaces, loadRecentWorkspaces, switchWorkspace };
}
