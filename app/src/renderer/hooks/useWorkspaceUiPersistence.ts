import { useEffect } from "react";
import { api } from "../api.js";
import {
  useWorkspaceStore,
  type Tab,
  type TerminalLayout,
} from "../stores/workspace-store.js";
import type { AgentConfig, WorktreeInfo } from "@sproutgit/types";

/**
 * Keeps the workspace UI's transient session state (active worktree/tab,
 * terminal layout, sidebar collapse) mirrored into sessionStorage so it
 * survives a reload, auto-switches the active tab away from one that just
 * became unavailable, loads the default shell preference, and wires the
 * Cmd/Ctrl+B sidebar-toggle shortcut.
 */
export function useWorkspaceUiPersistence(params: {
  workspacePath: string;
  activeWorktree: WorktreeInfo | null;
  activeTab: Tab;
  terminalLayout: TerminalLayout;
  agentConfig: AgentConfig | null;
  sidebarCollapsed: boolean;
  setSidebarCollapsed: (updater: (collapsed: boolean) => boolean) => void;
}) {
  const {
    workspacePath,
    activeWorktree,
    activeTab,
    terminalLayout,
    agentConfig,
    sidebarCollapsed,
    setSidebarCollapsed,
  } = params;

  // ── Default shell preference ──────────────────────────────────────────
  useEffect(() => {
    void api
      .getSetting("default_shell")
      .then((v: string | null) =>
        useWorkspaceStore.setState({ defaultShell: v ?? "" }),
      )
      .catch(() => undefined);
  }, [workspacePath]);

  // ── Session persistence ───────────────────────────────────────────────

  useEffect(() => {
    if (activeWorktree)
      sessionStorage.setItem("sg_active_wt", activeWorktree.path);
  }, [activeWorktree]);

  // ── Auto-switch tab if activeTab becomes disabled ─────────────────────
  useEffect(() => {
    if (
      !activeWorktree &&
      (activeTab === "staging" ||
        activeTab === "terminal" ||
        activeTab === "chat" ||
        activeTab === "files")
    ) {
      useWorkspaceStore.setState({ activeTab: "graph" });
    }
    if (
      activeTab === "chat" &&
      agentConfig &&
      agentConfig.mode !== "integrated"
    ) {
      useWorkspaceStore.setState({ activeTab: "graph" });
    }
  }, [activeWorktree, activeTab, agentConfig]);

  useEffect(() => {
    sessionStorage.setItem("sg_active_tab", activeTab);
  }, [activeTab]);

  useEffect(() => {
    sessionStorage.setItem("sg_terminal_layout", terminalLayout);
  }, [terminalLayout]);

  useEffect(() => {
    sessionStorage.setItem(
      "sg_sidebar_collapsed",
      sidebarCollapsed ? "1" : "0",
    );
  }, [sidebarCollapsed]);

  // ── Cmd/Ctrl+B toggles the worktree sidebar ("work mode") ──────────────
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (!(e.metaKey || e.ctrlKey) || e.key.toLowerCase() !== "b") return;
      // Don't hijack Cmd/Ctrl+B while the user is typing (e.g. it's "bold" in
      // a rich-text/contentEditable field, or a meaningful character in a
      // terminal/input) or if another handler already consumed the event.
      if (e.defaultPrevented) return;
      const target = e.target;
      if (target instanceof HTMLElement) {
        const tag = target.tagName;
        if (tag === "INPUT" || tag === "TEXTAREA" || target.isContentEditable)
          return;
      }
      e.preventDefault();
      setSidebarCollapsed((v) => !v);
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [setSidebarCollapsed]);
}
