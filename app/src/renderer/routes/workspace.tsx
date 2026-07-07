import { api } from "../api.js";
import { createRoute, useNavigate, useSearch } from "@tanstack/react-router";
import { rootRoute } from "./__root.js";
import { useEffect, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import {
  StagingPanel,
  Spinner,
  ContextMenuProvider,
  CommandPalette,
  type CommandPaletteItem,
} from "@sproutgit/ui";
import { GitBranch, GitMerge, Terminal, Bot, FileCode2, Plus, Trash2, Settings, FolderOpen, RefreshCw, ArrowDownToLine, ArrowUpToLine, SlidersHorizontal, AppWindow } from "lucide-react";
import type { WorktreeInfo, TerminalInfo, SessionAttention } from "@sproutgit/types";
import { useToast } from "../toast-context.js";
import { useWorkspaceStore } from "../stores/workspace-store.js";
import {
  tabKey,
  setActiveTab as setActiveEditorTab,
  closeTab as closeEditorTab,
  setTabContent,
  resolveConflictKeepMine,
} from "../stores/editor-store.js";
import { WorktreeSidebar } from "../workspace/WorktreeSidebar.js";
import { AgentSessionsPanel } from "../workspace/AgentSessionsPanel.js";
import { ChatPanel } from "../workspace/ChatPanel.js";
import { FileTreePanel } from "../workspace/FileTreePanel.js";
import { FileEditorPanel } from "../workspace/FileEditorPanel.js";
import { WorkspaceHeader } from "../workspace/WorkspaceHeader.js";
import { GraphTabPanel } from "../workspace/GraphTabPanel.js";
import { TerminalTabPanel } from "../workspace/TerminalTabPanel.js";
import { WorkspaceDialogs } from "../workspace/WorkspaceDialogs.js";
import { loadCommitMessageGeneratorSettings } from "../commit-message-generator-settings.js";
import { useAgentConfig } from "../hooks/useAgentConfig.js";
import { useAvailableShells } from "../hooks/useAvailableShells.js";
import { useRecentWorkspaces } from "../hooks/useRecentWorkspaces.js";
import { useScaffoldKickoff } from "../hooks/useScaffoldKickoff.js";
import { useWorktreeSelection } from "../hooks/useWorktreeSelection.js";
import { useCommitDiffState } from "../hooks/useCommitDiffState.js";
import { useTerminalManager } from "../hooks/useTerminalManager.js";
import { useSessionAttention } from "../hooks/useSessionAttention.js";
import { useAgentSessionNotifications } from "../hooks/useAgentSessionNotifications.js";
import { useAutoUpdateListeners } from "../hooks/useAutoUpdateListeners.js";
import { useMcpSessionDoneListener } from "../hooks/useMcpSessionDoneListener.js";
import { useWorkspaceFileWatchers } from "../hooks/useWorkspaceFileWatchers.js";
import { useWorkspaceUiPersistence } from "../hooks/useWorkspaceUiPersistence.js";
import { useEditorTabsForWorktree } from "../hooks/useEditorTabsForWorktree.js";
import { useFileEditorActions } from "../hooks/useFileEditorActions.js";
import { useRemoteOps } from "../hooks/useRemoteOps.js";
import {
  qk,
  useWorkspaceStatus,
  useWorktrees,
  useCommits,
  useCommitCount,
  useRefs,
  usePushStatus,
  useDeleteWorktree,
  useRestoreWorktree,
  useWorktreeChangeCounts,
  useIssueTrackerPatterns,
  useFileTree,
  useGithubAuthStatus,
  usePrStatuses,
} from "../queries.js";

// ── Search params ─────────────────────────────────────────────────────────────

type WorkspaceSearch = { path: string };

// ── Workspace view ────────────────────────────────────────────────────────────

function WorkspaceView() {
  return (
    <ContextMenuProvider>
      <WorkspaceInner />
    </ContextMenuProvider>
  );
}

function WorkspaceInner() {
  const navigate = useNavigate();
  const toast = useToast();
  const qc = useQueryClient();
  const { path: workspacePath } = useSearch({ from: workspaceRoute.id });

  // ── Zustand UI state ──────────────────────────────────────────────────
  const activeWorktree = useWorkspaceStore((s) => s.activeWorktree);
  const activeTab = useWorkspaceStore((s) => s.activeTab);
  const defaultShell = useWorkspaceStore((s) => s.defaultShell);
  const fetching = useWorkspaceStore((s) => s.fetching);
  const pulling = useWorkspaceStore((s) => s.pulling);
  const pushing = useWorkspaceStore((s) => s.pushing);
  const terminalSessions = useWorkspaceStore((s) => s.terminalSessions);
  const creatingWorktree = useWorkspaceStore((s) => s.creatingWorktree);
  const pendingCreationBranch = useWorkspaceStore(
    (s) => s.pendingCreationBranch,
  );
  const updateState = useAutoUpdateListeners();
  useMcpSessionDoneListener(toast);

  // ── File editor tabs (Zustand) ─────────────────────────────────────────
  const { editorTabsForActiveWorktree, editorActiveTabKey, activeEditorTab } =
    useEditorTabsForWorktree(activeWorktree?.path);
  const { openFile, saveFile, reloadFileFromDisk } = useFileEditorActions({
    activeWorktree,
    toast,
  });

  // ── Shell picker ──────────────────────────────────────────────────────
  const availableShells = useAvailableShells();

  // ── Coding agent ──────────────────────────────────────────────────────
  const { agentConfig, agentConfigured } = useAgentConfig();
  const chatAutoPrompt = useScaffoldKickoff({
    activeWorktree,
    agentConfig,
    workspacePath,
    toast,
  });

  // Worktree paths that currently have a live agent-launched terminal session.
  const worktreesWithLiveAgent = new Set(
    terminalSessions.filter((s) => s.agentId !== null).map((s) => s.cwd),
  );

  // ── Agent session attention (working/awaiting-permission/awaiting-input/finished/failed) ──
  const { bySessionId: attentionBySession, byWorktreePath: attentionByWorktree, waitingCount } =
    useSessionAttention();

  // ── Server state via TanStack Query ──────────────────────────────────
  const { data: workspaceStatus } = useWorkspaceStatus(workspacePath);
  // Use '' (falsy) until workspaceStatus resolves so dependent queries stay
  // disabled — workspacePath itself is not a git repo in the .sproutgit layout.
  const gitRepoPath = workspaceStatus?.gitRepoPath ?? "";

  const { data: worktrees = [], isLoading: worktreesLoading } = useWorktrees(
    gitRepoPath,
    workspaceStatus?.worktreesPath,
  );

  const {
    data: commits = [],
    isLoading: commitsLoading,
    isFetching: commitsFetching,
  } = useCommits(gitRepoPath);

  const { data: commitTotal = 0 } = useCommitCount(gitRepoPath);
  const { data: refs = [] } = useRefs(gitRepoPath);
  const { data: pushStatus } = usePushStatus(activeWorktree?.path);
  const { data: issueTrackerPatterns = [] } = useIssueTrackerPatterns(
    activeWorktree?.path,
  );
  const { data: fileTree = [], isLoading: fileTreeLoading } = useFileTree(
    activeWorktree?.path,
  );

  const loading = worktreesLoading || commitsLoading;

  // ── Worktree change counts (sidebar badges) ───────────────────────────
  const rootP = workspaceStatus?.rootPath;
  const worktreeChangeCounts = useWorktreeChangeCounts(worktrees, rootP);

  // ── PR + checks status (sidebar badges) ───────────────────────────────
  const { data: githubAuth } = useGithubAuthStatus();
  const githubConnected = githubAuth?.authenticated ?? false;
  const prStatuses = usePrStatuses(worktrees, rootP, githubConnected);
  const [createPrTarget, setCreatePrTarget] = useState<WorktreeInfo | null>(
    null,
  );
  const [prDetailsTarget, setPrDetailsTarget] = useState<WorktreeInfo | null>(
    null,
  );

  // ── Recent workspaces (for the title bar's workspace switcher) ─────────
  const { loadRecentWorkspaces, switchWorkspace } =
    useRecentWorkspaces(workspacePath);

  // ── Local UI state ────────────────────────────────────────────────────
  const [hooksModalOpen, setHooksModalOpen] = useState(false);
  const [showPublishModal, setShowPublishModal] = useState(false);
  const [runHookTarget, setRunHookTarget] = useState<WorktreeInfo | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<WorktreeInfo | null>(null);
  const [showNewWorktree, setShowNewWorktree] = useState(false);
  const [sessionsPanelOpen, setSessionsPanelOpen] = useState(false);
  const [showCommandPalette, setShowCommandPalette] = useState(false);
  const [sidebarCollapsed, setSidebarCollapsed] = useState(
    () => sessionStorage.getItem("sg_sidebar_collapsed") === "1",
  );
  // Temporary shim — StagingPanel still uses this until it is refactored to useQuery
  const [stagingRefresh, setStagingRefresh] = useState(0);

  // ── Mutations ─────────────────────────────────────────────────────────
  const deleteWorktreeMutation = useDeleteWorktree(gitRepoPath);
  const restoreWorktreeMutation = useRestoreWorktree(gitRepoPath);
  const { doFetch, doPull, doPush } = useRemoteOps({
    activeWorktreePath: activeWorktree?.path,
    gitRepoPath,
    pushStatus,
    toast,
    onPushNeedsPublish: () => setShowPublishModal(true),
  });

  // ── Worktree selection (initial pick, switch, delete, create-hooks) ───
  const {
    setPendingNewWorktreePath,
    handleWorktreeSwitch,
    doDeleteWorktree,
    runCreateHooksFor,
  } = useWorktreeSelection({
    workspacePath,
    worktrees,
    rootPath: rootP,
    gitRepoPath,
    workspaceStatus,
    activeWorktree,
    deleteWorktreeMutation,
    restoreWorktreeMutation,
    toast,
    closeDeleteDialog: () => setDeleteTarget(null),
  });

  /** Jump-to-terminal action from the agent sessions dashboard (and from
   *  clicking an agent-session-finished OS notification): switches to the
   *  session's worktree (if not already active) and focuses its terminal tab. */
  function handleJumpToSession(session: { id: string; cwd: string }) {
    const wt = worktrees.find((w) => w.path === session.cwd);
    // The dashboard already filters to this workspace's worktrees, but guard
    // here too — jumping to a session with no matching worktree would leave
    // activeTerminalId pointing at a tab that can never render.
    if (!wt) return;
    if (wt.path !== activeWorktree?.path) {
      void handleWorktreeSwitch(wt);
    }
    useWorkspaceStore.setState((s) => ({
      activeTerminalId: session.id,
      activeTab: "terminal",
      worktreeActiveTerminalId: {
        ...s.worktreeActiveTerminalId,
        [session.cwd]: session.id,
      },
    }));
    setSessionsPanelOpen(false);
  }

  /** Jump-to-prompt action from an "awaiting" badge/indicator: switches to the
   *  session's worktree (if not already active) and focuses the tab holding
   *  the pending prompt — the chat tab's permission card for ACP sessions, or
   *  the terminal tab for PTY agent sessions. */
  function handleJumpToAttention(entry: SessionAttention) {
    const wt = worktrees.find((w) => w.path === entry.worktreePath);
    if (!wt) return;
    if (wt.path !== activeWorktree?.path) {
      void handleWorktreeSwitch(wt);
    }
    if (entry.kind === "chat") {
      useWorkspaceStore.setState({ activeTab: "chat" });
    } else {
      useWorkspaceStore.setState((s) => ({
        activeTerminalId: entry.sessionId,
        activeTab: "terminal",
        worktreeActiveTerminalId: {
          ...s.worktreeActiveTerminalId,
          [entry.worktreePath]: entry.sessionId,
        },
      }));
    }
    setSessionsPanelOpen(false);
  }

  /** Click handler for the header's "N waiting" indicator: jumps straight to
   *  the oldest-waiting session's pending prompt (rather than just opening
   *  the sessions panel, which doesn't list chat sessions at all). Falls back
   *  to toggling the panel in the unlikely event `waitingCount` reached 0
   *  between render and click. */
  function handleJumpToNextWaiting() {
    const awaiting = Object.values(attentionBySession)
      .filter((entry) => entry.state === "awaiting-permission" || entry.state === "awaiting-input")
      .sort((a, b) => a.updatedAt - b.updatedAt);
    if (awaiting.length === 0) {
      setSessionsPanelOpen((v) => !v);
      return;
    }
    handleJumpToAttention(awaiting[0]!);
  }

  useAgentSessionNotifications({ worktrees, onJump: handleJumpToSession });

  // ── Commit diff state ──────────────────────────────────────────────────
  const {
    selectedCommits,
    selectedCommit,
    commitDiffFiles,
    commitDiffContent,
    commitDiffFile,
    commitDiffLoading,
    commitDiffFileLoading,
    loadCommitDiff,
    loadCommitRangeDiff,
    loadCommitDiffFile,
    clearCommitDiff,
  } = useCommitDiffState({ gitRepoPath, toast });

  // ── Terminal sessions ──────────────────────────────────────────────────
  const terminalManager = useTerminalManager({
    workspacePath,
    activeWorktreePath: activeWorktree?.path,
    defaultShell,
    toast,
  });

  // ── Background watchers / subscriptions ───────────────────────────────
  useWorkspaceFileWatchers({
    workspacePath,
    gitRepoPath,
    activeWorktreePath: activeWorktree?.path,
    worktrees,
    qc,
    toast,
  });
  useWorkspaceUiPersistence({
    workspacePath,
    activeWorktree,
    activeTab,
    terminalLayout: terminalManager.terminalLayout,
    agentConfig,
    sidebarCollapsed,
    setSidebarCollapsed,
  });

  // ── Cmd/Ctrl+K opens the command palette ────────────────────────────────
  // Unlike Cmd/Ctrl+B (useWorkspaceUiPersistence), this intentionally does
  // NOT bail out while an input/textarea has focus — command palettes
  // conventionally open from anywhere (VS Code, Linear, etc). It does bail
  // if another modal is already open, to avoid stacking overlays.
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (!(e.metaKey || e.ctrlKey) || e.key.toLowerCase() !== "k") return;
      if (e.defaultPrevented) return;
      if (
        showNewWorktree ||
        showPublishModal ||
        !!runHookTarget ||
        !!deleteTarget ||
        !!createPrTarget ||
        hooksModalOpen ||
        sessionsPanelOpen
      ) return;
      e.preventDefault();
      setShowCommandPalette((v) => !v);
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [showNewWorktree, showPublishModal, runHookTarget, deleteTarget, createPrTarget, hooksModalOpen, sessionsPanelOpen]);

  // ── Style helpers ─────────────────────────────────────────────────────

  function tabCls(active: boolean, disabled: boolean = false) {
    return `sg-tab flex items-center gap-1.5 px-3 h-full text-xs cursor-pointer bg-transparent border-t-0 border-x-0 border-b-2 transition-colors whitespace-nowrap ${
      disabled
        ? "text-(--sg-text-dim) border-transparent cursor-not-allowed opacity-50"
        : active
          ? "text-(--sg-primary) border-(--sg-primary) font-medium cursor-pointer"
          : "text-(--sg-text-faint) border-transparent hover:text-(--sg-text) cursor-pointer"
    }`;
  }

  // ── Command palette (Cmd/Ctrl+K) ─────────────────────────────────────────

  const commandItems: CommandPaletteItem[] = [
    ...worktrees.filter((wt) => wt.path !== rootP).flatMap((wt): CommandPaletteItem[] => {
      const label = wt.branch ?? wt.path;
      const items: CommandPaletteItem[] = [{
        id: `worktree-switch:${wt.path}`,
        label: `Switch to ${label}`,
        group: 'Worktrees',
        keywords: wt.path,
        icon: <GitBranch size={14} />,
        onSelect: () => void handleWorktreeSwitch(wt),
      }];
      if (agentConfigured) {
        items.push({
          id: `worktree-agent:${wt.path}`,
          label: `Launch Agent in ${label}`,
          group: 'Worktrees',
          keywords: wt.path,
          icon: <Bot size={14} />,
          onSelect: () => void terminalManager.launchAgent(wt.path, agentConfig?.id),
        });
      }
      items.push({
        id: `worktree-delete:${wt.path}`,
        label: `Delete Worktree: ${label}`,
        group: 'Worktrees',
        keywords: wt.path,
        icon: <Trash2 size={14} />,
        onSelect: () => setDeleteTarget(wt),
      });
      return items;
    }),
    {
      id: 'worktree-create',
      label: 'Create Worktree…',
      group: 'Worktrees',
      icon: <Plus size={14} />,
      onSelect: () => setShowNewWorktree(true),
    },
    {
      id: 'nav-graph',
      label: 'Go to Graph',
      group: 'Navigate',
      icon: <GitBranch size={14} />,
      onSelect: () => useWorkspaceStore.setState({ activeTab: 'graph' }),
    },
    ...(activeWorktree ? [{
      id: 'nav-changes',
      label: 'Go to Changes',
      group: 'Navigate',
      icon: <GitMerge size={14} />,
      onSelect: () => useWorkspaceStore.setState({ activeTab: 'staging' }),
    }] : []),
    ...(activeWorktree ? [{
      id: 'nav-terminal',
      label: 'Go to Terminal',
      group: 'Navigate',
      icon: <Terminal size={14} />,
      onSelect: () => {
        if (terminalManager.visibleSessions.length === 0) void terminalManager.openTerminal(activeWorktree.path);
        else useWorkspaceStore.setState({ activeTab: 'terminal' });
      },
    }] : []),
    ...(activeWorktree && agentConfig?.mode === 'integrated' ? [{
      id: 'nav-chat',
      label: 'Go to Chat',
      group: 'Navigate',
      icon: <Bot size={14} />,
      onSelect: () => useWorkspaceStore.setState({ activeTab: 'chat' }),
    }] : []),
    ...(activeWorktree ? [{
      id: 'nav-files',
      label: 'Go to Files',
      group: 'Navigate',
      icon: <FileCode2 size={14} />,
      onSelect: () => useWorkspaceStore.setState({ activeTab: 'files' }),
    }] : []),
    {
      id: 'nav-settings',
      label: 'Open Settings',
      group: 'Navigate',
      icon: <Settings size={14} />,
      onSelect: () => void navigate({ to: '/settings', search: { workspace: workspacePath } }),
    },
    {
      id: 'nav-projects',
      label: 'Back to Projects',
      group: 'Navigate',
      icon: <FolderOpen size={14} />,
      onSelect: () => void navigate({ to: '/' }),
    },
    {
      id: 'nav-agent-sessions',
      label: 'Agent Sessions',
      group: 'Navigate',
      icon: <Bot size={14} />,
      onSelect: () => setSessionsPanelOpen((v) => !v),
    },
    ...(activeWorktree ? [
      {
        id: 'git-fetch',
        label: 'Fetch',
        group: 'Git',
        icon: <RefreshCw size={14} />,
        onSelect: () => void doFetch(),
      },
      {
        id: 'git-pull',
        label: 'Pull',
        group: 'Git',
        icon: <ArrowDownToLine size={14} />,
        onSelect: () => void doPull(),
      },
      {
        id: 'git-push',
        label: 'Push',
        group: 'Git',
        icon: <ArrowUpToLine size={14} />,
        onSelect: () => void doPush(),
      },
    ] : []),
    {
      id: 'workspace-hooks',
      label: 'Workspace Hooks…',
      group: 'Workspace',
      icon: <SlidersHorizontal size={14} />,
      onSelect: () => setHooksModalOpen(true),
    },
    ...(activeWorktree ? [{
      id: 'new-terminal',
      label: 'New Terminal',
      group: 'Workspace',
      icon: <Terminal size={14} />,
      onSelect: () => void terminalManager.openTerminal(activeWorktree.path),
    }] : []),
    {
      id: 'toggle-sidebar',
      label: sidebarCollapsed ? 'Expand Sidebar' : 'Collapse Sidebar',
      group: 'Workspace',
      shortcut: 'Cmd/Ctrl+B',
      onSelect: () => setSidebarCollapsed((v) => !v),
    },
    {
      id: 'new-window',
      label: 'New Window',
      group: 'Workspace',
      icon: <AppWindow size={14} />,
      onSelect: () => void api.openNewWindow(),
    },
  ];

  // ── Render ────────────────────────────────────────────────────────────

  return (
    <>
      <div className="flex flex-col h-full overflow-hidden">
        <WorkspaceHeader
          workspacePath={workspacePath}
          activeWorktree={activeWorktree}
          updateState={updateState}
          loadRecentWorkspaces={loadRecentWorkspaces}
          onSwitchWorkspace={switchWorkspace}
          hasLiveAgentSession={worktreesWithLiveAgent.size > 0}
          waitingCount={waitingCount}
          onToggleSessionsPanel={() => setSessionsPanelOpen((v) => !v)}
          onJumpToNextWaiting={handleJumpToNextWaiting}
        />

        {/* ── Body: sidebar + main content ── */}
        <div className="flex flex-1 min-h-0 overflow-hidden">
          {/* Worktree sidebar */}
          <WorktreeSidebar
            workspacePath={workspacePath}
            worktrees={worktrees}
            activeWorktree={activeWorktree}
            workspaceStatus={workspaceStatus ?? null}
            worktreeChangeCounts={worktreeChangeCounts}
            prStatuses={prStatuses}
            githubConnected={githubConnected}
            fetching={fetching}
            pulling={pulling}
            pushing={pushing}
            creatingWorktree={creatingWorktree}
            pendingCreationBranch={pendingCreationBranch}
            updateState={updateState}
            collapsed={sidebarCollapsed}
            onToggleCollapsed={() => setSidebarCollapsed((v) => !v)}
            onWorktreeSwitch={(wt) => void handleWorktreeSwitch(wt)}
            onFetch={() => void doFetch()}
            onPull={() => void doPull()}
            onPush={() => void doPush()}
            onRefresh={() => {
              void qc.invalidateQueries({
                queryKey: qk.worktrees(gitRepoPath),
              });
              void qc.invalidateQueries({ queryKey: qk.commits(gitRepoPath) });
              void qc.invalidateQueries({ queryKey: qk.refs(gitRepoPath) });
              if (activeWorktree)
                void qc.invalidateQueries({
                  queryKey: qk.pushStatus(activeWorktree.path),
                });
            }}
            onNewWorktree={() => setShowNewWorktree(true)}
            onOpenTerminal={(cwd, label) =>
              void terminalManager.openTerminal(cwd, label)
            }
            onOpenHooksModal={() => setHooksModalOpen(true)}
            onOpenRunHookModal={(wt) => setRunHookTarget(wt)}
            onRunCreateHooks={(wt) => void runCreateHooksFor(wt)}
            onDeleteWorktree={(wt) => setDeleteTarget(wt)}
            agentConfigured={agentConfigured}
            worktreesWithLiveAgent={worktreesWithLiveAgent}
            attentionByWorktree={attentionByWorktree}
            onJumpToAttention={handleJumpToAttention}
            onLaunchAgent={(wtPath) => void terminalManager.launchAgent(wtPath, agentConfig?.id)}
            onCreatePr={(wt) => setCreatePrTarget(wt)}
            onOpenPrDetails={(wt) => setPrDetailsTarget(wt)}
          />

          {/* Main content */}
          <div className="flex-1 flex flex-col overflow-hidden">
            {/* Tab bar */}
            <div className="flex items-center border-b border-(--sg-border) bg-(--sg-surface) shrink-0 h-(--sg-toolbar-height)">
              <button
                className={tabCls(activeTab === "graph")}
                onClick={() =>
                  useWorkspaceStore.setState({ activeTab: "graph" })
                }
              >
                <GitBranch size={12} /> Graph
              </button>
              <button
                className={tabCls(activeTab === "staging", !activeWorktree)}
                onClick={() => {
                  if (!activeWorktree) return;
                  useWorkspaceStore.setState({ activeTab: "staging" });
                  // Force a fresh git status whenever the user clicks Changes,
                  // so newly-written files are always visible without a watcher event.
                  setStagingRefresh((n) => n + 1);
                }}
                disabled={!activeWorktree}
              >
                <GitMerge size={12} /> Changes
                {activeWorktree &&
                  (worktreeChangeCounts[activeWorktree.path] ?? 0) > 0 && (
                    <span className="ml-1 rounded-full bg-(--sg-warning)/20 px-1.5 py-0 text-[9px] leading-4 font-semibold text-(--sg-warning)">
                      {worktreeChangeCounts[activeWorktree.path]}
                    </span>
                  )}
              </button>
              <button
                className={tabCls(activeTab === "terminal", !activeWorktree)}
                onClick={() => {
                  if (!activeWorktree) return;
                  if (terminalManager.visibleSessions.length === 0) {
                    void terminalManager.openTerminal(activeWorktree.path);
                  } else {
                    useWorkspaceStore.setState({ activeTab: "terminal" });
                  }
                }}
                disabled={!activeWorktree}
              >
                <Terminal size={12} /> Terminal
                {terminalManager.visibleSessions.length > 1
                  ? ` (${terminalManager.visibleSessions.length})`
                  : ""}
              </button>
              {agentConfig?.mode === "integrated" && (
                <button
                  className={tabCls(activeTab === "chat", !activeWorktree)}
                  onClick={() => {
                    if (!activeWorktree) return;
                    useWorkspaceStore.setState({ activeTab: "chat" });
                  }}
                  disabled={!activeWorktree}
                  data-testid="tab-chat"
                >
                  <Bot size={12} /> Chat
                </button>
              )}
              <button
                className={tabCls(activeTab === "files", !activeWorktree)}
                onClick={() => {
                  if (!activeWorktree) return;
                  useWorkspaceStore.setState({ activeTab: "files" });
                }}
                disabled={!activeWorktree}
                data-testid="tab-files"
              >
                <FileCode2 size={12} /> Files
              </button>
            </div>

            {/* Tab content */}
            <div className="flex-1 overflow-hidden relative">
              {loading ? (
                <div className="flex items-center justify-center h-full">
                  <Spinner size="lg" />
                </div>
              ) : (
                <>
                  {/* Graph tab */}
                  {activeTab === "graph" && (
                    <GraphTabPanel
                      commits={commits}
                      worktrees={worktrees}
                      activeWorktree={activeWorktree}
                      commitTotal={commitTotal}
                      commitsFetching={commitsFetching}
                      gitRepoPath={gitRepoPath}
                      issueTrackerPatterns={issueTrackerPatterns}
                      qc={qc}
                      toast={toast}
                      onCreateWorktree={() => setShowNewWorktree(true)}
                      selectedCommits={selectedCommits}
                      selectedCommit={selectedCommit}
                      commitDiffFiles={commitDiffFiles}
                      commitDiffContent={commitDiffContent}
                      commitDiffFile={commitDiffFile}
                      commitDiffLoading={commitDiffLoading}
                      commitDiffFileLoading={commitDiffFileLoading}
                      onSelectCommit={(commit) => void loadCommitDiff(commit)}
                      onSelectCommitRange={(from, to) =>
                        void loadCommitRangeDiff(from, to)
                      }
                      onClearCommitSelection={clearCommitDiff}
                      onSelectDiffFile={(file) => void loadCommitDiffFile(file)}
                    />
                  )}

                  {/* Staging tab */}
                  {activeTab === "staging" && activeWorktree && (
                    <StagingPanel
                      worktreePath={activeWorktree.path}
                      branch={activeWorktree.branch ?? null}
                      refreshSignal={stagingRefresh}
                      getStatus={(p) => api.getStatus(p)}
                      stageFiles={(p, paths) => api.stageFiles(p, paths)}
                      unstageFiles={(p, paths) => api.unstageFiles(p, paths)}
                      stageHunk={(p, filePath, hunkIndex, lineIndices) => api.stageHunk(p, filePath, hunkIndex, lineIndices)}
                      unstageHunk={(p, filePath, hunkIndex, lineIndices) => api.unstageHunk(p, filePath, hunkIndex, lineIndices)}
                      createCommit={(p, msg) => api.createCommit(p, msg)}
                      getDiff={(p, staged, file) =>
                        staged
                          ? api.getStagedFileDiff(p, file)
                          : api.getUnstagedFileDiff(p, file ?? "")
                      }
                      generateCommitMessage={async (p) => {
                        const settings =
                          await loadCommitMessageGeneratorSettings();
                        return api.generateCommitMessage({
                          workspacePath,
                          worktreePath: p,
                          settings,
                        });
                      }}
                      listStashes={p => api.listStashes(p)}
                      createStash={(p, message) => api.createStash(p, message)}
                      applyStash={(p, ref) => api.applyStash(p, ref)}
                      popStash={(p, ref) => api.popStash(p, ref)}
                      dropStash={(p, ref) => api.dropStash(p, ref)}
                      onCommit={() => {
                        toast("Committed", "success");
                        setStagingRefresh((n) => n + 1);
                        void qc.invalidateQueries({
                          queryKey: qk.commits(gitRepoPath),
                        });
                        void qc.invalidateQueries({
                          queryKey: qk.commitCount(gitRepoPath),
                        });
                        void qc.invalidateQueries({
                          queryKey: qk.refs(gitRepoPath),
                        });
                        if (activeWorktree)
                          void qc.invalidateQueries({
                            queryKey: qk.worktreeStatus(activeWorktree.path),
                          });
                      }}
                      onClose={() =>
                        useWorkspaceStore.setState({ activeTab: "graph" })
                      }
                      onToast={(msg, v) => toast(msg, v)}
                    />
                  )}

                  {/* Terminal tab */}
                  {activeTab === "terminal" && activeWorktree && (
                    <TerminalTabPanel
                      workspacePath={workspacePath}
                      activeWorktreePath={activeWorktree.path}
                      visibleSessions={terminalManager.visibleSessions}
                      activeTerminalId={terminalManager.activeTerminalId}
                      terminalLayout={terminalManager.terminalLayout}
                      availableShells={availableShells}
                      renamingTerminalId={terminalManager.renamingTerminalId}
                      renameValue={terminalManager.renameValue}
                      setRenameValue={terminalManager.setRenameValue}
                      renameInputRef={terminalManager.renameInputRef}
                      onOpenTerminal={(cwd, label, shellOverride) =>
                        void terminalManager.openTerminal(
                          cwd,
                          label,
                          shellOverride,
                        )
                      }
                      onCloseTerminal={(id) =>
                        void terminalManager.closeTerminal(id)
                      }
                      onOpenTerminalTabMenu={(e, id) =>
                        terminalManager.openTerminalTabMenu(e, id)
                      }
                      onSelectTerminal={(id) =>
                        useWorkspaceStore.setState({
                          activeTerminalId: id,
                          activeTab: "terminal",
                        })
                      }
                      onCommitRename={terminalManager.commitTerminalRename}
                      onCancelRename={terminalManager.cancelTerminalRename}
                      onSetLayout={(layout) =>
                        useWorkspaceStore.setState({ terminalLayout: layout })
                      }
                      terminalPanelStyle={terminalManager.terminalPanelStyle}
                      terminalWrapperClass={
                        terminalManager.terminalWrapperClass
                      }
                    />
                  )}

                  {/* Chat tab (Integrated AI agent mode) */}
                  {activeTab === "chat" &&
                    activeWorktree &&
                    agentConfig?.mode === "integrated" && (
                      <ChatPanel
                        worktreePath={activeWorktree.path}
                        {...(chatAutoPrompt
                          ? { autoPrompt: chatAutoPrompt }
                          : {})}
                      />
                    )}

                  {/* Files tab */}
                  {activeTab === "files" && activeWorktree && (
                    <div className="flex h-full">
                      <div className="w-56 shrink-0 border-r border-(--sg-border)">
                        <FileTreePanel
                          tree={fileTree}
                          loading={fileTreeLoading}
                          activeRelativePath={
                            activeEditorTab?.relativePath ?? null
                          }
                          onOpenFile={(rel) => void openFile(rel)}
                          onRefresh={() =>
                            void qc.invalidateQueries({
                              queryKey: qk.fileTree(activeWorktree.path),
                            })
                          }
                        />
                      </div>
                      <div className="min-w-0 flex-1">
                        <FileEditorPanel
                          tabs={editorTabsForActiveWorktree}
                          activeTabKey={editorActiveTabKey}
                          keyOf={(t) => tabKey(t.worktreePath, t.relativePath)}
                          onSelectTab={(key) => setActiveEditorTab(key)}
                          onCloseTab={(key) => closeEditorTab(key)}
                          onChange={(key, content) =>
                            setTabContent(key, content)
                          }
                          onSave={(key) => void saveFile(key)}
                          onReloadFromDisk={(key) =>
                            void reloadFileFromDisk(key)
                          }
                          onKeepMine={(key) => resolveConflictKeepMine(key)}
                        />
                      </div>
                    </div>
                  )}
                </>
              )}
            </div>
          </div>
        </div>
        {/* end body */}
      </div>

      {/* Agent sessions dashboard */}
      <AgentSessionsPanel
        open={sessionsPanelOpen}
        worktrees={worktrees}
        attentionBySession={attentionBySession}
        onJump={(session) => handleJumpToSession(session)}
        onClose={() => setSessionsPanelOpen(false)}
      />

      {/* Command palette */}
      <CommandPalette
        open={showCommandPalette}
        onClose={() => setShowCommandPalette(false)}
        items={commandItems}
      />

      <WorkspaceDialogs
        workspacePath={workspacePath}
        activeWorktree={activeWorktree}
        gitRepoPath={gitRepoPath}
        defaultShell={defaultShell}
        refs={refs}
        issueTrackerPatterns={issueTrackerPatterns}
        pushStatus={pushStatus}
        managedWorktreesPath={workspaceStatus?.worktreesPath}
        toast={toast}
        hooksModalOpen={hooksModalOpen}
        onCloseHooksModal={() => setHooksModalOpen(false)}
        showNewWorktree={showNewWorktree}
        onCloseNewWorktree={() => setShowNewWorktree(false)}
        onWorktreeCreated={(newWorktreePath) => {
          // Hooks (before/after_worktree_create) and issue-ref provenance now
          // run server-side as part of the worktree:create IPC call itself
          // (see app/src/main/worktree-lifecycle.ts) — the only thing left
          // for the renderer to do here is its own UI-state bookkeeping.
          setPendingNewWorktreePath(newWorktreePath);
          void qc.invalidateQueries({ queryKey: qk.worktrees(gitRepoPath) });
          void qc.invalidateQueries({ queryKey: qk.refs(gitRepoPath) });
        }}
        showPublishModal={showPublishModal}
        onClosePublishModal={() => setShowPublishModal(false)}
        onPublished={() =>
          activeWorktree &&
          void qc.invalidateQueries({
            queryKey: qk.pushStatus(activeWorktree.path),
          })
        }
        createPrTarget={createPrTarget}
        onCloseCreatePr={() => setCreatePrTarget(null)}
        onPrCreated={() =>
          createPrTarget &&
          void qc.invalidateQueries({
            queryKey: qk.prStatus(createPrTarget.path),
          })
        }
        prDetailsTarget={prDetailsTarget}
        prDetailsStatus={prDetailsTarget ? (prStatuses[prDetailsTarget.path] ?? null) : null}
        onClosePrDetails={() => setPrDetailsTarget(null)}
        runHookTarget={runHookTarget}
        onCloseRunHookModal={() => setRunHookTarget(null)}
        deleteTarget={deleteTarget}
        deleteLoading={deleteWorktreeMutation.isPending}
        onConfirmDelete={(wt) => void doDeleteWorktree(wt)}
        onCancelDelete={() => setDeleteTarget(null)}
      />
    </>
  );
}

export const workspaceRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/workspace",
  validateSearch: (search: Record<string, unknown>): WorkspaceSearch => ({
    path: typeof search["path"] === "string" ? search["path"] : "",
  }),
  component: WorkspaceView,
});
