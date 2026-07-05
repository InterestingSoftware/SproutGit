import { api } from '../api.js';
import { createRoute, useNavigate, useSearch } from '@tanstack/react-router';
import { rootRoute } from './__root.js';
import { useState, useEffect, useRef } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import {
  CommitGraph,
  StagingPanel,
  TerminalPane,
  Spinner,
  ContextMenuProvider,
  useContextMenu,
  WorkspaceHooksModal,
  WindowControls,
  UpdateBadge,
} from '@sproutgit/ui';
import { GitBranch, Terminal, GitMerge, X, ChevronRight, ChevronDown, Settings, Plus, Columns2, Rows3, LayoutGrid, Pencil, PanelTop, SquareSplitHorizontal, ChevronsRight, Trash2, Bot, FileCode2, AppWindow, FolderOpen } from 'lucide-react';
import type { CommitEntry, DiffFileEntry, WorktreeInfo, WorktreeSwitchHookSource, AgentConfig, FileChangedEvent, RecentWorkspace } from '@sproutgit/types';
import { useToast } from '../toast-context.js';
import { reportError } from '../error-reporting.js';
import { useUpdateStore } from '../stores/update-store.js';
import { useWorkspaceStore, resetWorkspaceStore } from '../stores/workspace-store.js';
import {
  useEditorStore,
  tabKey,
  openOrFocusTab,
  setTabLoaded,
  setTabError,
  setTabContent,
  setTabSaved,
  handleExternalChange,
  resolveConflictReload,
  resolveConflictKeepMine,
  closeTab as closeEditorTab,
  setActiveTab as setActiveEditorTab,
} from '../stores/editor-store.js';
import { WorktreeSidebar } from '../workspace/WorktreeSidebar.js';
import { ChatPanel } from '../workspace/ChatPanel.js';
import { CommitDiffPanel } from '../workspace/CommitDiffPanel.js';
import { FileTreePanel } from '../workspace/FileTreePanel.js';
import { FileEditorPanel } from '../workspace/FileEditorPanel.js';
import { NewWorktreeDialog } from '../workspace/dialogs/NewWorktreeDialog.js';
import { DeleteWorktreeDialog } from '../workspace/dialogs/DeleteWorktreeDialog.js';
import { PublishDialog } from '../workspace/dialogs/PublishDialog.js';
import { RunHookDialog } from '../workspace/dialogs/RunHookDialog.js';
import { loadCommitMessageGeneratorSettings } from '../commit-message-generator-settings.js';
import {
  qk,
  useWorkspaceStatus,
  useWorktrees,
  useCommits,
  useCommitCount,
  useRefs,
  usePushStatus,
  useFetch,
  describeFetchSummary,
  usePull,
  usePush,
  useDeleteWorktree,
  useWorktreeChangeCounts,
  useIssueTrackerPatterns,
  useFileTree,
} from '../queries.js';

// ── Search params ─────────────────────────────────────────────────────────────

type WorkspaceSearch = { path: string };

// ── Shared helpers ────────────────────────────────────────────────────────────

/** Last path segment, tolerating both '/' (macOS/Linux) and '\' (Windows) separators. */
function workspaceBaseName(p: string): string {
  const trimmed = p.trim().replace(/[\\/]+$/g, '');
  const idx = Math.max(trimmed.lastIndexOf('/'), trimmed.lastIndexOf('\\'));
  return idx === -1 ? trimmed : trimmed.slice(idx + 1);
}

async function runSwitchAndTriggerHooks(args: {
  workspacePath: string;
  targetWorktreePath: string;
  initiatingWorktreePath: string | null;
  source: WorktreeSwitchHookSource;
}): Promise<void> {
  await api.runSwitchHooks(args);
  await api.runTriggerHooks({
    workspacePath: args.workspacePath,
    trigger: 'after_worktree_switch',
    worktreePath: args.targetWorktreePath,
    initiatingWorktreePath: args.initiatingWorktreePath,
    source: args.source,
  });
}

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
  const contextMenu = useContextMenu();
  const { path: workspacePath } = useSearch({ from: workspaceRoute.id });

  // ── Zustand UI state ──────────────────────────────────────────────────
  const activeWorktree = useWorkspaceStore(s => s.activeWorktree);
  const activeTab = useWorkspaceStore(s => s.activeTab);
  const defaultShell = useWorkspaceStore(s => s.defaultShell);
  const fetching = useWorkspaceStore(s => s.fetching);
  const pulling = useWorkspaceStore(s => s.pulling);
  const pushing = useWorkspaceStore(s => s.pushing);
  const terminalSessions = useWorkspaceStore(s => s.terminalSessions);
  const activeTerminalId = useWorkspaceStore(s => s.activeTerminalId);
  const terminalLayout = useWorkspaceStore(s => s.terminalLayout);
  const worktreeActiveTerminalId = useWorkspaceStore(s => s.worktreeActiveTerminalId);
  const creatingWorktree = useWorkspaceStore(s => s.creatingWorktree);
  const pendingCreationBranch = useWorkspaceStore(s => s.pendingCreationBranch);
  const { updateState, setUpdateState } = useUpdateStore();

  // Sessions for the currently selected worktree. All other sessions keep
  // their PTYs running in the background and reappear when you switch back.
  const visibleSessions = terminalSessions.filter(s => s.cwd === activeWorktree?.path);

  // ── File editor tabs (Zustand) ─────────────────────────────────────────
  const editorTabs = useEditorStore(s => s.tabs);
  const editorTabOrder = useEditorStore(s => s.tabOrder);
  const editorActiveTabKeyRaw = useEditorStore(s => s.activeTabKey);
  const editorTabsForActiveWorktree = editorTabOrder
    .map(k => editorTabs[k])
    .filter((t): t is NonNullable<typeof t> => !!t && t.worktreePath === activeWorktree?.path);
  const editorActiveTabKey = editorTabsForActiveWorktree.some(t => tabKey(t.worktreePath, t.relativePath) === editorActiveTabKeyRaw)
    ? editorActiveTabKeyRaw
    : null;
  const activeEditorTab = editorTabsForActiveWorktree.find(t => tabKey(t.worktreePath, t.relativePath) === editorActiveTabKey) ?? null;

  // ── Shell picker ──────────────────────────────────────────────────────
  const [availableShells, setAvailableShells] = useState<{ name: string; path: string }[]>([]);
  const [showShellPicker, setShowShellPicker] = useState(false);

  useEffect(() => {
    // Intentionally silent: worst case the shell picker just shows no options.
    void api.listShells().then(setAvailableShells).catch(() => undefined);
  }, []);

  // ── Coding agent ──────────────────────────────────────────────────────
  const [agentConfig, setAgentConfig] = useState<AgentConfig | null>(null);

  useEffect(() => {
    // A failure here leaves the Chat tab looking unconfigured with no
    // indication why — surface it instead.
    void api.getAgentConfig().then(setAgentConfig).catch((err: unknown) => reportError('Failed to load agent configuration', err));
  }, []);
  const agentConfigured = !!agentConfig?.command.trim();

  // Worktree paths that currently have a live agent-launched terminal session.
  const worktreesWithLiveAgent = new Set(
    terminalSessions.filter(s => s.agentId !== null).map(s => s.cwd),
  );

  // ── Server state via TanStack Query ──────────────────────────────────
  const { data: workspaceStatus } = useWorkspaceStatus(workspacePath);
  // Use '' (falsy) until workspaceStatus resolves so dependent queries stay
  // disabled — workspacePath itself is not a git repo in the .sproutgit layout.
  const gitRepoPath = workspaceStatus?.gitRepoPath ?? '';

  const {
    data: worktrees = [],
    isLoading: worktreesLoading,
  } = useWorktrees(gitRepoPath, workspaceStatus?.worktreesPath);

  const {
    data: commits = [],
    isLoading: commitsLoading,
    isFetching: commitsFetching,
  } = useCommits(gitRepoPath);

  const { data: commitTotal = 0 } = useCommitCount(gitRepoPath);
  const { data: refs = [] } = useRefs(gitRepoPath);
  const { data: pushStatus } = usePushStatus(activeWorktree?.path);
  const { data: issueTrackerPatterns = [] } = useIssueTrackerPatterns(activeWorktree?.path);
  const { data: fileTree = [], isLoading: fileTreeLoading } = useFileTree(activeWorktree?.path);

  const loading = worktreesLoading || commitsLoading;

  // ── Worktree change counts (sidebar badges) ───────────────────────────
  const rootP = workspaceStatus?.rootPath;
  const worktreeChangeCounts = useWorktreeChangeCounts(worktrees, rootP);

  // ── Pick initial active worktree once worktrees load ─────────────────
  const [pendingNewWorktreePath, setPendingNewWorktreePath] = useState<string | null>(null);

  useEffect(() => {
    // Filter out root worktree — it should never be active
    const selectableWorktrees = worktrees.filter(w => w.path !== rootP);
    if (selectableWorktrees.length === 0) {
      useWorkspaceStore.setState({ activeWorktree: null });
      return;
    }

    const workspaceChanged = lastWorktreeWorkspaceRef.current !== workspacePath;
    lastWorktreeWorkspaceRef.current = workspacePath;

    // If the workspace hasn't changed, preserve an already-valid selection
    // (e.g. a new worktree was added/removed — don't reset the active one).
    if (!workspaceChanged) {
      // If a new worktree was just created, switch to it automatically.
      if (pendingNewWorktreePath) {
        const newWt = selectableWorktrees.find(w => w.path === pendingNewWorktreePath);
        if (newWt) {
          const prevPath = useWorkspaceStore.getState().activeWorktree?.path ?? null;
          setPendingNewWorktreePath(null);
          useWorkspaceStore.setState(s => ({
            activeWorktree: newWt,
            worktreeActiveTerminalId: {
              ...s.worktreeActiveTerminalId,
              ...(prevPath ? { [prevPath]: s.activeTerminalId } : {}),
            },
            activeTerminalId: s.worktreeActiveTerminalId[newWt.path] ?? null,
          }));
          void runSwitchAndTriggerHooks({ workspacePath, targetWorktreePath: newWt.path, initiatingWorktreePath: prevPath, source: 'create' })
            .catch((err: unknown) => toast(`Switch hooks failed: ${String(err)}`, 'error'));
          return;
        }
      }
      const current = useWorkspaceStore.getState().activeWorktree;
      if (current && selectableWorktrees.some(w => w.path === current.path)) return;
    }

    // On workspace open: restore the last-selected worktree from the DB, fall
    // back to first non-detached, then first overall.
    void api.getWorkspaceState(workspacePath, 'activeWorktreePath').then(saved => {
      const restored = saved ? (selectableWorktrees.find(w => w.path === saved) ?? null) : null;
      const initial = restored ?? selectableWorktrees.find(w => !w.detached) ?? selectableWorktrees[0] ?? null;
      useWorkspaceStore.setState({ activeWorktree: initial });
      if (initial) {
        void runSwitchAndTriggerHooks({ workspacePath, targetWorktreePath: initial.path, initiatingWorktreePath: null, source: 'load' })
          .catch((err: unknown) => toast(`Switch hooks failed: ${String(err)}`, 'error'));
      }
    }).catch(() => {
      const initial = selectableWorktrees.find(w => !w.detached) ?? selectableWorktrees[0] ?? null;
      useWorkspaceStore.setState({ activeWorktree: initial });
      if (initial) {
        void runSwitchAndTriggerHooks({ workspacePath, targetWorktreePath: initial.path, initiatingWorktreePath: null, source: 'load' })
          .catch((err: unknown) => toast(`Switch hooks failed: ${String(err)}`, 'error'));
      }
    });
    // toast is recreated every render (see toast-context.tsx) — omit it so
    // this effect only reruns when the worktree selection actually changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [worktrees, rootP, workspacePath, pendingNewWorktreePath]);

  // ── Local UI state ────────────────────────────────────────────────────
  const [hooksModalOpen, setHooksModalOpen] = useState(false);
  const [showPublishModal, setShowPublishModal] = useState(false);
  const [runHookTarget, setRunHookTarget] = useState<WorktreeInfo | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<WorktreeInfo | null>(null);
  const [showNewWorktree, setShowNewWorktree] = useState(false);
  const [sidebarCollapsed, setSidebarCollapsed] = useState(() => sessionStorage.getItem('sg_sidebar_collapsed') === '1');
  const [recentWorkspaces, setRecentWorkspaces] = useState<RecentWorkspace[]>([]);

  // Commit diff state
  const [selectedCommits, setSelectedCommits] = useState<CommitEntry[]>([]);
  const [commitDiffRange, setCommitDiffRange] = useState<string | null>(null);
  const [commitDiffFiles, setCommitDiffFiles] = useState<DiffFileEntry[]>([]);
  const [commitDiffContent, setCommitDiffContent] = useState('');
  const [commitDiffFile, setCommitDiffFile] = useState<DiffFileEntry | null>(null);
  const [commitDiffLoading, setCommitDiffLoading] = useState(false);
  const [commitDiffFileLoading, setCommitDiffFileLoading] = useState(false);
  const [renamingTerminalId, setRenamingTerminalId] = useState<string | null>(null);
  const [renameValue, setRenameValue] = useState('');
  // Temporary shim — StagingPanel still uses this until it is refactored to useQuery
  const [stagingRefresh, setStagingRefresh] = useState(0);

  // Non-reactive terminal data buffer
  const terminalDataRef = useRef<Map<string, string>>(new Map());
  const renameInputRef = useRef<HTMLInputElement | null>(null);
  const lastWorktreeWorkspaceRef = useRef('');

  const selectedCommit = selectedCommits[0] ?? null;

  // ── Mutations ─────────────────────────────────────────────────────────
  const fetchMutation = useFetch(activeWorktree?.path ?? '', gitRepoPath);
  const pullMutation = usePull(activeWorktree?.path ?? '', gitRepoPath);
  const pushMutation = usePush(activeWorktree?.path ?? '');
  const deleteWorktreeMutation = useDeleteWorktree(gitRepoPath);

  // ── Reset UI state when workspace path changes ────────────────────────

  useEffect(() => {
    resetWorkspaceStore(workspacePath);
  }, [workspacePath]);

  // ── Recent workspaces (for the title bar's workspace switcher) ─────────

  async function loadRecentWorkspaces(): Promise<RecentWorkspace[]> {
    try {
      const ws = await api.listRecentWorkspaces();
      const sorted = [...ws].sort((a, b) => new Date(b.lastOpenedAt).getTime() - new Date(a.lastOpenedAt).getTime());
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
    void navigate({ to: '/workspace', search: { path } });
  }

  // ── Default shell preference ──────────────────────────────────────────
  useEffect(() => {
    void api.getSetting('default_shell')
      .then((v: string | null) => useWorkspaceStore.setState({ defaultShell: v ?? '' }))
      .catch(() => undefined);
  }, [workspacePath]);

  // ── MCP server auto-start ────────────────────────────────────────────
  // No-op unless the user previously enabled MCP for this workspace in
  // Settings — this just makes "enabled" survive across app restarts.
  // Gated on gitRepoPath for the same reason as the file watcher below:
  // checking/persisting MCP state touches .sproutgit/state.db, which would
  // otherwise get created (via openWorkspaceDb's side effect) inside a
  // not-yet-migrated plain repo and make its working tree look dirty right
  // as the legacy-layout bare-repo migration runs.
  // Intentionally no stop-on-unmount: like background terminal sessions,
  // the server should keep running while the app is open even after
  // navigating away from this workspace view; it's torn down on workspace
  // close (WORKSPACE_CLOSE) and app quit instead.
  useEffect(() => {
    if (!gitRepoPath) return;
    // A failure here means the MCP server just doesn't start, invisibly —
    // surface it instead.
    void api.mcpEnsureStarted(workspacePath).catch((err: unknown) => reportError('Failed to start MCP server', err));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [gitRepoPath]);

  // ── Close terminals when switching to a DIFFERENT workspace ──────────
  // We use a ref so the cleanup only fires when the path genuinely changes
  // (not when the component unmounts on navigation to the Projects screen).
  const prevWorkspacePathRef = useRef<string>(workspacePath);
  useEffect(() => {
    const prevPath = prevWorkspacePathRef.current;
    prevWorkspacePathRef.current = workspacePath;
    if (prevPath && prevPath !== workspacePath) {
      void api.closeTerminalsForPath(prevPath);
    }
  }, [workspacePath]);

  // ── File watcher → invalidate queries ────────────────────────────────
  // Wait for gitRepoPath (root, always bare) to be known before watching —
  // starting earlier would watch the pre-migration path, and on Windows
  // `fs.watch` holds an open handle that blocks the rename that converts a
  // workspace to the bare-root layout (EPERM).

  useEffect(() => {
    if (!gitRepoPath) return;
    // A failure here means the app silently stops picking up external
    // changes (branch switches, commits, worktree adds from another tool)
    // for the whole session — surface it rather than letting the workspace
    // look "stuck"/stale with no explanation.
    void api.startWatching(gitRepoPath).catch((err: unknown) =>
      toast(`Failed to watch workspace for changes: ${String(err)}`, 'error'));
    const offWorktree = api.onWorktreeChanged(() => {
      void qc.invalidateQueries({ queryKey: qk.worktrees(gitRepoPath) });
    });
    const offRefs = api.onGitRefsChanged(() => {
      void qc.invalidateQueries({ queryKey: qk.commits(gitRepoPath) });
      void qc.invalidateQueries({ queryKey: qk.refs(gitRepoPath) });
    });
    return () => {
      void api.stopWatching(gitRepoPath).catch(() => undefined);
      offWorktree();
      offRefs();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [gitRepoPath]);

  // ── File content watcher (active worktree) → file tree + open tab live-sync ──
  // Distinct from the workspace-level watcher above (which only tracks .git/*
  // for branch/ref changes) — this one covers the working tree's file
  // *contents* so the file browser refreshes and open editor tabs pick up
  // external edits (e.g. an AI agent or another tool writing to a file).
  //
  // It also doubles as a fast path for the Changes tab's status query: any
  // content change likely means `git status` changed too, so invalidate it
  // immediately instead of waiting on its 15s poll (kept as a fallback for
  // changes this watcher can't see, e.g. an index/stash operation from
  // another tool with no working-tree file write).
  useEffect(() => {
    const worktreePath = activeWorktree?.path;
    if (!worktreePath) return;

    void api.startFileWatching(worktreePath);
    const offFileChanged = api.onFileChanged((event: FileChangedEvent) => {
      if (event.worktreePath !== worktreePath) return;
      void qc.invalidateQueries({ queryKey: qk.fileTree(worktreePath) });
      void qc.invalidateQueries({ queryKey: qk.worktreeStatus(worktreePath) });
      if (gitRepoPath) void qc.invalidateQueries({ queryKey: qk.worktreeChangeCounts(gitRepoPath) });

      const key = tabKey(worktreePath, event.relativePath);
      if (!useEditorStore.getState().tabs[key]) return;

      if (event.type === 'deleted') return; // leave the buffer as-is; save will recreate the file

      api.readFile(worktreePath, event.relativePath)
        .then(result => {
          // Re-read the tab's current state rather than the one captured
          // before this async read started — it may have been saved,
          // reloaded, or closed while the read was in flight.
          const currentTab = useEditorStore.getState().tabs[key];
          if (!currentTab) return;
          if (result.mtimeMs <= currentTab.knownMtimeMs) return;
          handleExternalChange(key, result.content, result.mtimeMs);
        })
        .catch(() => undefined);
    });

    return () => {
      void api.stopFileWatching(worktreePath);
      offFileChanged();
    };
  }, [activeWorktree?.path, gitRepoPath, qc]);

  // ── Refresh worktrees when the window regains focus ───────────────────
  // Catches worktrees an external tool (e.g. Claude Code) registered while
  // this window was unfocused, on top of the filesystem watcher above.
  useEffect(() => {
    if (!gitRepoPath) return;
    const onFocus = () => void qc.invalidateQueries({ queryKey: qk.worktrees(gitRepoPath) });
    window.addEventListener('focus', onFocus);
    return () => window.removeEventListener('focus', onFocus);
  }, [gitRepoPath, qc]);

  // ── Drop worktree_metadata rows for worktrees that have disappeared ────
  // Best-effort bookkeeping cleanup only — never runs `git worktree prune`.
  useEffect(() => {
    if (!workspacePath || worktrees.length === 0) return;
    void api.pruneWorktreeMetadata({
      workspacePath,
      activeWorktreePaths: worktrees.map(w => w.path),
    }).catch(() => undefined);
  }, [workspacePath, worktrees]);

  // ── Session persistence ───────────────────────────────────────────────

  useEffect(() => {
    if (activeWorktree) sessionStorage.setItem('sg_active_wt', activeWorktree.path);
  }, [activeWorktree]);

  // ── Auto-switch tab if activeTab becomes disabled ─────────────────────
  useEffect(() => {
    if (!activeWorktree && (activeTab === 'staging' || activeTab === 'terminal' || activeTab === 'chat' || activeTab === 'files')) {
      useWorkspaceStore.setState({ activeTab: 'graph' });
    }
    if (activeTab === 'chat' && agentConfig && agentConfig.mode !== 'integrated') {
      useWorkspaceStore.setState({ activeTab: 'graph' });
    }
  }, [activeWorktree, activeTab, agentConfig]);

  useEffect(() => {
    sessionStorage.setItem('sg_active_tab', activeTab);
  }, [activeTab]);

  useEffect(() => {
    sessionStorage.setItem('sg_terminal_layout', terminalLayout);
  }, [terminalLayout]);

  useEffect(() => {
    sessionStorage.setItem('sg_sidebar_collapsed', sidebarCollapsed ? '1' : '0');
  }, [sidebarCollapsed]);

  // ── Cmd/Ctrl+B toggles the worktree sidebar ("work mode") ──────────────
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (!(e.metaKey || e.ctrlKey) || e.key.toLowerCase() !== 'b') return;
      // Don't hijack Cmd/Ctrl+B while the user is typing (e.g. it's "bold" in
      // a rich-text/contentEditable field, or a meaningful character in a
      // terminal/input) or if another handler already consumed the event.
      if (e.defaultPrevented) return;
      const target = e.target;
      if (target instanceof HTMLElement) {
        const tag = target.tagName;
        if (tag === 'INPUT' || tag === 'TEXTAREA' || target.isContentEditable) return;
      }
      e.preventDefault();
      setSidebarCollapsed(v => !v);
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  useEffect(() => {
    // If the active terminal was closed (not in any session), fall back to
    // the last visible session for the current worktree.
    if (activeTerminalId && !terminalSessions.some(s => s.id === activeTerminalId)) {
      const activePath = useWorkspaceStore.getState().activeWorktree?.path;
      const last = terminalSessions.filter(s => s.cwd === activePath).at(-1)?.id ?? null;
      useWorkspaceStore.setState({ activeTerminalId: last });
    }
    if (renamingTerminalId && !terminalSessions.some(s => s.id === renamingTerminalId)) {
      setRenamingTerminalId(null);
      setRenameValue('');
    }
  }, [activeTerminalId, renamingTerminalId, terminalSessions]);

  useEffect(() => {
    if (!renamingTerminalId || !renameInputRef.current) return;
    renameInputRef.current.focus();
    renameInputRef.current.select();
  }, [renamingTerminalId]);

  // ── Terminal IPC ──────────────────────────────────────────────────────

  useEffect(() => {
    const offData = api.onTerminalData((id: string, data: string) => {
      const prev = terminalDataRef.current.get(id) ?? '';
      terminalDataRef.current.set(id, prev + data);
      useWorkspaceStore.setState(s => ({
        terminalSessions: s.terminalSessions.map(sess =>
          sess.id === id ? { ...sess, pendingData: terminalDataRef.current.get(id) ?? '' } : sess
        ),
      }));
    });

    const offExit = api.onTerminalExit((id: string) => {
      useWorkspaceStore.setState(s => {
        const remaining = s.terminalSessions.filter(sess => sess.id !== id);
        const currentPath = s.activeWorktree?.path;
        const visibleRemaining = remaining.filter(sess => sess.cwd === currentPath);
        return {
          terminalSessions: remaining,
          activeTerminalId: s.activeTerminalId === id
            ? (visibleRemaining.at(-1)?.id ?? null)
            : s.activeTerminalId,
        };
      });
    });

    return () => { offData(); offExit(); };
  }, []);

  // ── Hook terminal launch listener ─────────────────────────────────────

  useEffect(() => {
    const offHookTerminal = api.onHookTerminalLaunch((event) => {
      const label = `hook: ${event.hookName}`;
      useWorkspaceStore.setState(s => {
        const cwd = event.cwd;
        return {
          terminalSessions: [...s.terminalSessions, {
            id: event.terminalId,
            cwd,
            label: makeTerminalLabel(s.terminalSessions.filter(sess => sess.cwd === cwd), label),
            pendingData: '',
            agentId: null,
          }],
          activeTerminalId: event.terminalId,
          activeTab: 'terminal',
          worktreeActiveTerminalId: {
            ...s.worktreeActiveTerminalId,
            [cwd]: event.terminalId,
          },
        };
      });
    });

    return () => { offHookTerminal(); };
  }, []);

  // ── Agent terminal launch listener ─────────────────────────────────────

  useEffect(() => {
    const offAgentTerminal = api.onAgentTerminalLaunch((event) => {
      useWorkspaceStore.setState(s => {
        const cwd = event.cwd;
        return {
          terminalSessions: [...s.terminalSessions, {
            id: event.terminalId,
            cwd,
            label: makeTerminalLabel(s.terminalSessions.filter(sess => sess.cwd === cwd), 'AI Agent'),
            pendingData: '',
            agentId: 'agent',
          }],
          activeTerminalId: event.terminalId,
          activeTab: 'terminal',
          worktreeActiveTerminalId: {
            ...s.worktreeActiveTerminalId,
            [cwd]: event.terminalId,
          },
        };
      });
    });

    return () => { offAgentTerminal(); };
  }, []);

  // ── Auto-update listeners ─────────────────────────────────────────────

  useEffect(() => {
    const offChecking = api.onUpdateChecking(() => setUpdateState({ status: 'checking' }));
    const offAvailable = api.onUpdateAvailable((version: string) => setUpdateState({ status: 'available', version }));
    const offNotAvailable = api.onUpdateNotAvailable(() => setUpdateState({ status: 'up-to-date' }));
    const offDownloading = api.onUpdateDownloading((progress: number) => setUpdateState({ status: 'downloading', progress }));
    const offReady = api.onUpdateReady(() => setUpdateState({ status: 'ready' }));
    const offError = api.onUpdateError((message: string) => {
      reportError('Update failed', message);
      setUpdateState({ status: 'idle' });
    });
    return () => { offChecking(); offAvailable(); offNotAvailable(); offDownloading(); offReady(); offError(); };
  }, [setUpdateState]);

  // ── Actions ───────────────────────────────────────────────────────────

  async function doFetch() {
    if (!activeWorktree) return;
    useWorkspaceStore.setState({ fetching: true });
    try {
      const summary = await fetchMutation.mutateAsync();
      toast(describeFetchSummary(summary), summary.hadNoRemotes ? 'info' : 'success');
    } catch (err) {
      toast(`Fetch failed: ${String(err)}`, 'error');
    } finally {
      useWorkspaceStore.setState({ fetching: false });
    }
  }

  async function doPull() {
    if (!activeWorktree) return;
    useWorkspaceStore.setState({ pulling: true });
    try {
      await pullMutation.mutateAsync();
      toast('Pulled', 'success');
    } catch (err) {
      toast(`Pull failed: ${String(err)}`, 'error');
    } finally {
      useWorkspaceStore.setState({ pulling: false });
    }
  }

  async function doPush() {
    if (!activeWorktree) return;
    if (!pushStatus?.upstream) {
      setShowPublishModal(true);
      return;
    }
    useWorkspaceStore.setState({ pushing: true });
    try {
      await pushMutation.mutateAsync();
      toast('Pushed', 'success');
    } catch (err) {
      toast(`Push failed: ${String(err)}`, 'error');
    } finally {
      useWorkspaceStore.setState({ pushing: false });
    }
  }

  async function handleWorktreeSwitch(wt: WorktreeInfo) {
    if (activeWorktree?.path === wt.path) return;
    const prevPath = activeWorktree?.path ?? null;
    // Save the active terminal for the outgoing worktree and restore the
    // last known active terminal for the incoming worktree.
    useWorkspaceStore.setState(s => {
      const savedForTarget = s.worktreeActiveTerminalId[wt.path] ?? null;
      const visibleForTarget = s.terminalSessions.filter(sess => sess.cwd === wt.path);
      const restoredId = savedForTarget && visibleForTarget.some(sess => sess.id === savedForTarget)
        ? savedForTarget
        : (visibleForTarget.at(-1)?.id ?? null);
      return {
        activeWorktree: wt,
        activeTerminalId: restoredId,
        worktreeActiveTerminalId: {
          ...s.worktreeActiveTerminalId,
          ...(prevPath ? { [prevPath]: s.activeTerminalId } : {}),
        },
      };
    });
    void api.setWorkspaceState(workspacePath, 'activeWorktreePath', wt.path).catch(() => undefined);
    void runSwitchAndTriggerHooks({ workspacePath, targetWorktreePath: wt.path, initiatingWorktreePath: prevPath, source: 'manual' })
      .catch((err: unknown) => toast(`Switch hooks failed: ${String(err)}`, 'error'));
  }

  async function doDeleteWorktree(wt: WorktreeInfo) {
    const isDeletingActive = activeWorktree?.path === wt.path;
    const nextWt = isDeletingActive
      ? worktrees.find(w => w.path !== wt.path && w.path !== workspaceStatus?.rootPath)
      ?? null
      : null;

    try {
      if (isDeletingActive && nextWt) {
        try {
          await api.runSwitchHooks({
            workspacePath,
            targetWorktreePath: nextWt.path,
            initiatingWorktreePath: wt.path,
            source: 'delete',
          });
          await api.runTriggerHooks({
            workspacePath,
            trigger: 'after_worktree_switch',
            worktreePath: nextWt.path,
            initiatingWorktreePath: wt.path,
            source: 'delete',
          });
        } catch { /* non-critical */ }
      }

      // before/after_worktree_remove hooks and terminal cleanup now run
      // server-side as part of the worktree:delete IPC call itself (see
      // app/src/main/worktree-lifecycle.ts). afterRemoveWorktreePath is the
      // UI's own "next active worktree" concept (no MCP equivalent), passed
      // through explicitly so the after-hook's env vars still reflect it.
      const afterRemoveWorktreePath = (nextWt ?? activeWorktree)?.path ?? null;

      // Switch the active worktree away *before* the mutation so that no git
      // queries fire on the deleted path while or after the deletion runs.
      if (isDeletingActive) useWorkspaceStore.setState({ activeWorktree: nextWt });
      await deleteWorktreeMutation.mutateAsync({
        workspacePath,
        rootRepoPath: gitRepoPath,
        ...(workspaceStatus?.worktreesPath ? { managedWorktreesPath: workspaceStatus.worktreesPath } : {}),
        worktreePath: wt.path,
        // Never delete the branch of an external worktree — an external tool
        // owns it. The main process re-enforces this guard server-side too.
        deleteBranch: !wt.isExternal && !!wt.branch,
        branchName: wt.branch ?? null,
        initiatingWorktreePath: activeWorktree?.path ?? null,
        afterRemoveWorktreePath,
      });

      toast('Worktree removed', 'success');
    } catch (err) {
      toast(`Failed to remove worktree: ${String(err)}`, 'error');
    } finally {
      setDeleteTarget(null);
    }
  }

  // after_worktree_create hooks never fire retroactively for a worktree we
  // adopted rather than created — this lets the user opt in explicitly
  // (e.g. to run a dependency install) from the worktree's context menu.
  async function runCreateHooksFor(wt: WorktreeInfo) {
    try {
      await api.runCreateHooks({
        workspacePath,
        newWorktreePath: wt.path,
        initiatingWorktreePath: activeWorktree?.path ?? null,
      });
      toast('Create hooks ran', 'success');
    } catch (err) {
      toast(`Create hooks failed: ${String(err)}`, 'error');
    }
  }

  async function loadCommitDiff(commit: CommitEntry) {
    setSelectedCommits([commit]);
    setCommitDiffFile(null);
    setCommitDiffContent('');
    setCommitDiffLoading(true);
    try {
      const range = commit.parents.length > 0
        ? `${commit.parents[0]}..${commit.hash}`
        : commit.hash;
      setCommitDiffRange(range);
      const files = await api.getDiffFiles(gitRepoPath, range);
      setCommitDiffFiles(files as DiffFileEntry[]);
    } catch (err) {
      toast(`Failed to load commit diff: ${String(err)}`, 'error');
      setCommitDiffFiles([]);
    } finally {
      setCommitDiffLoading(false);
    }
  }

  async function loadCommitRangeDiff(from: CommitEntry, to: CommitEntry) {
    setSelectedCommits([from, to]);
    setCommitDiffFile(null);
    setCommitDiffContent('');
    setCommitDiffLoading(true);
    try {
      const range = `${from.hash}..${to.hash}`;
      setCommitDiffRange(range);
      const files = await api.getDiffFiles(gitRepoPath, range);
      setCommitDiffFiles(files as DiffFileEntry[]);
    } catch (err) {
      toast(`Failed to load range diff: ${String(err)}`, 'error');
      setCommitDiffFiles([]);
    } finally {
      setCommitDiffLoading(false);
    }
  }

  async function loadCommitDiffFile(file: DiffFileEntry) {
    if (!selectedCommit) return;
    setCommitDiffFile(file);
    setCommitDiffFileLoading(true);
    try {
      const range = commitDiffRange ?? (
        selectedCommit.parents.length > 0
          ? `${selectedCommit.parents[0]}..${selectedCommit.hash}`
          : selectedCommit.hash
      );
      const content = await api.getDiffContent(gitRepoPath, range, file.path);
      setCommitDiffContent(content as string);
    } catch (err) {
      toast(`Failed to load diff: ${String(err)}`, 'error');
      setCommitDiffContent('');
    } finally {
      setCommitDiffFileLoading(false);
    }
  }

  // ── File editor tabs ──────────────────────────────────────────────────

  async function openFile(relativePath: string) {
    if (!activeWorktree) return;
    const worktreePath = activeWorktree.path;
    const key = openOrFocusTab(worktreePath, relativePath);
    useWorkspaceStore.setState({ activeTab: 'files' });
    const tab = useEditorStore.getState().tabs[key];
    if (!tab) return;
    // "already loaded" means a load previously succeeded, not that the
    // content happens to be non-empty — an actually-empty file would
    // otherwise get re-read every time the tab is reopened/focused.
    if (!tab.loading && !tab.error) return;
    try {
      const result = await api.readFile(worktreePath, relativePath);
      setTabLoaded(key, result.content, result.mtimeMs);
    } catch (err) {
      setTabError(key, `Failed to read file: ${String(err)}`);
    }
  }

  async function saveFile(key: string) {
    const tab = useEditorStore.getState().tabs[key];
    if (!tab || !tab.dirty) return;
    try {
      const result = await api.writeFile(tab.worktreePath, tab.relativePath, tab.content);
      setTabSaved(key, tab.content, result.mtimeMs);
    } catch (err) {
      toast(`Failed to save ${tab.relativePath}: ${String(err)}`, 'error');
    }
  }

  async function reloadFileFromDisk(key: string) {
    const tab = useEditorStore.getState().tabs[key];
    if (!tab) return;
    try {
      const result = await api.readFile(tab.worktreePath, tab.relativePath);
      resolveConflictReload(key, result.content, result.mtimeMs);
    } catch (err) {
      toast(`Failed to reload ${tab.relativePath}: ${String(err)}`, 'error');
    }
  }

  async function openTerminal(cwd: string, label?: string, shellOverride?: string) {
    try {
      const terminalArgs: {
        cwd: string;
        label?: string;
        shell?: string;
      } = { cwd };
      if (label) terminalArgs.label = label;
      const resolvedShell = shellOverride ?? defaultShell;
      if (resolvedShell) terminalArgs.shell = resolvedShell;
      const id = await api.createTerminal(terminalArgs);
      const shellLabel = shellDisplayName(resolvedShell);
      useWorkspaceStore.setState(s => ({
        terminalSessions: [...s.terminalSessions, {
          id,
          cwd,
          label: makeTerminalLabel(s.terminalSessions.filter(sess => sess.cwd === cwd), label ?? shellLabel),
          pendingData: '',
          agentId: null,
        }],
        activeTerminalId: id,
        activeTab: 'terminal',
        worktreeActiveTerminalId: { ...s.worktreeActiveTerminalId, [cwd]: id },
      }));
    } catch (err) {
      toast(`Failed to open terminal: ${String(err)}`, 'error');
    }
  }

  async function launchAgent(worktreePath: string) {
    try {
      await api.launchAgent({ workspacePath, worktreePath });
    } catch (err) {
      toast(`Failed to launch agent: ${String(err)}`, 'error');
    }
  }

  function shellDisplayName(shellPath: string | null | undefined): string {
    if (!shellPath) return 'terminal';
    const base = shellPath.split(/[/\\]/).pop() ?? shellPath;
    return base.replace(/\.exe$/i, '');
  }

  function makeTerminalLabel(sessions: typeof terminalSessions, baseLabel: string) {
    const trimmed = baseLabel.trim() || 'terminal';
    const existing = sessions.filter(s => s.label === trimmed).length;
    return existing === 0 ? trimmed : `${trimmed} (${existing + 1})`;
  }

  function terminalPanelStyle(id: string): React.CSSProperties {
    if (terminalLayout === 'tabs') {
      return {
        display: id === activeTerminalId ? 'block' : 'none',
        minHeight: 0,
        flex: 1,
      };
    }
    return {
      display: 'block',
      minHeight: 0,
      minWidth: 0,
      flex: 1,
    };
  }

  function terminalWrapperClass() {
    if (terminalLayout === 'split') return 'flex flex-1 min-h-0';
    if (terminalLayout === 'grid') return 'grid flex-1 min-h-0 grid-cols-2 auto-rows-fr';
    return 'flex flex-1 min-h-0 flex-col';
  }

  async function closeTerminal(id: string) {
    await api.closeTerminal(id).catch(() => undefined);
    useWorkspaceStore.setState(s => {
      const remaining = s.terminalSessions.filter(sess => sess.id !== id);
      const currentPath = s.activeWorktree?.path;
      const visibleRemaining = remaining.filter(sess => sess.cwd === currentPath);
      return {
        terminalSessions: remaining,
        activeTerminalId: s.activeTerminalId === id
          ? (visibleRemaining.at(-1)?.id ?? null)
          : s.activeTerminalId,
      };
    });
    if (renamingTerminalId === id) {
      setRenamingTerminalId(null);
      setRenameValue('');
    }
  }

  async function closeTerminals(ids: string[]) {
    if (ids.length === 0) return;
    await Promise.all(ids.map(id => api.closeTerminal(id).catch(() => undefined)));
    useWorkspaceStore.setState(s => {
      const idSet = new Set(ids);
      const remaining = s.terminalSessions.filter(sess => !idSet.has(sess.id));
      const currentPath = s.activeWorktree?.path;
      const visibleRemaining = remaining.filter(sess => sess.cwd === currentPath);
      return {
        terminalSessions: remaining,
        activeTerminalId: idSet.has(s.activeTerminalId ?? '')
          ? (visibleRemaining.at(-1)?.id ?? null)
          : s.activeTerminalId,
      };
    });
    if (renamingTerminalId && ids.includes(renamingTerminalId)) {
      setRenamingTerminalId(null);
      setRenameValue('');
    }
  }

  function startTerminalRename(id: string) {
    const session = terminalSessions.find(s => s.id === id);
    if (!session) return;
    useWorkspaceStore.setState({ activeTerminalId: id, activeTab: 'terminal' });
    setRenamingTerminalId(id);
    setRenameValue(session.label);
  }

  function commitTerminalRename() {
    if (!renamingTerminalId) return;
    const trimmed = renameValue.trim();
    if (trimmed) {
      useWorkspaceStore.setState(s => ({
        terminalSessions: s.terminalSessions.map(sess =>
          sess.id === renamingTerminalId ? { ...sess, label: trimmed } : sess,
        ),
      }));
    }
    setRenamingTerminalId(null);
    setRenameValue('');
  }

  function cancelTerminalRename() {
    setRenamingTerminalId(null);
    setRenameValue('');
  }

  function openTerminalTabMenu(e: React.MouseEvent, sessionId: string) {
    const index = visibleSessions.findIndex(s => s.id === sessionId);
    if (index === -1) return;
    const idsToRight = visibleSessions.slice(index + 1).map(s => s.id);
    const otherIds = visibleSessions.filter(s => s.id !== sessionId).map(s => s.id);
    contextMenu.open(e, [
      {
        label: 'Rename',
        icon: <Pencil size={14} />,
        onClick: () => startTerminalRename(sessionId),
      },
      {
        label: 'New Terminal',
        icon: <Plus size={14} />,
        onClick: () => {
          void openTerminal(activeWorktree?.path ?? workspacePath);
        },
      },
      'separator',
      {
        label: 'Tabbed Layout',
        icon: <PanelTop size={14} />,
        onClick: () => useWorkspaceStore.setState({ terminalLayout: 'tabs', activeTerminalId: sessionId, activeTab: 'terminal' }),
      },
      {
        label: 'Split Layout',
        icon: <SquareSplitHorizontal size={14} />,
        onClick: () => useWorkspaceStore.setState({ terminalLayout: 'split', activeTerminalId: sessionId, activeTab: 'terminal' }),
      },
      {
        label: 'Grid Layout',
        icon: <LayoutGrid size={14} />,
        onClick: () => useWorkspaceStore.setState({ terminalLayout: 'grid', activeTerminalId: sessionId, activeTab: 'terminal' }),
      },
      'separator',
      {
        label: 'Close',
        icon: <X size={14} />,
        danger: true,
        onClick: () => { void closeTerminal(sessionId); },
      },
      {
        label: 'Close Others',
        icon: <Trash2 size={14} />,
        disabled: otherIds.length === 0,
        danger: true,
        onClick: () => { void closeTerminals(otherIds); },
      },
      {
        label: 'Close To Right',
        icon: <ChevronsRight size={14} />,
        disabled: idsToRight.length === 0,
        danger: true,
        onClick: () => { void closeTerminals(idsToRight); },
      },
    ]);
  }

  // ── Style helpers ─────────────────────────────────────────────────────

  function tabCls(active: boolean, disabled: boolean = false) {
    return `sg-tab flex items-center gap-1.5 px-3 h-full text-xs cursor-pointer bg-transparent border-t-0 border-x-0 border-b-2 transition-colors whitespace-nowrap ${disabled
        ? 'text-(--sg-text-dim) border-transparent cursor-not-allowed opacity-50'
        : active
          ? 'text-(--sg-primary) border-(--sg-primary) font-medium cursor-pointer'
          : 'text-(--sg-text-faint) border-transparent hover:text-(--sg-text) cursor-pointer'
      }`;
  }

  const iconBtn = 'inline-flex items-center justify-center p-[3px] bg-transparent border-none cursor-pointer text-(--sg-text-faint) rounded-[4px] transition-colors hover:text-(--sg-text) hover:bg-(--sg-surface-raised) disabled:opacity-40 disabled:cursor-not-allowed';

  // ── Render ────────────────────────────────────────────────────────────

  return (
    <>
      <div className="flex flex-col h-full overflow-hidden">
        {/* ── Full-width top header (matches home page style) ── */}
        <header
          className="flex items-center h-(--sg-titlebar-height) shrink-0 border-b border-(--sg-border) bg-(--sg-surface)"
          style={{ WebkitAppRegion: 'drag' } as React.CSSProperties}
          data-testid="workspace-header"
        >
          <WindowControls />
          <div className="flex items-center gap-2 flex-1 min-w-0">
            <button
              className="group flex items-center gap-1 rounded-md px-2 py-1 text-xs text-(--sg-text-dim) transition-colors hover:bg-(--sg-surface-raised) hover:text-(--sg-text) border-none bg-transparent cursor-pointer"
              style={{ WebkitAppRegion: 'no-drag' } as React.CSSProperties}
              onClick={() => void navigate({ to: '/' })}
              data-testid="btn-back-projects"
            >
              <span className="transition-transform group-hover:-translate-x-0.5">←</span>
              <span>Projects</span>
            </button>
            <div className="h-3 w-px bg-(--sg-border)" />
            <button
              className="group/switcher flex items-center gap-0.5 rounded-md px-1.5 py-0.5 -mx-1.5 text-xs font-medium text-(--sg-text) transition-colors hover:bg-(--sg-surface-raised) border-none bg-transparent cursor-pointer max-w-45 min-w-0"
              style={{ WebkitAppRegion: 'no-drag' } as React.CSSProperties}
              title="Switch workspace"
              data-testid="btn-workspace-switcher"
              onClick={async e => {
                const fresh = await loadRecentWorkspaces();
                const others = fresh.filter(w => w.workspacePath !== workspacePath);
                contextMenu.open(e, others.length > 0
                  ? others.map(w => ({
                    label: workspaceBaseName(w.workspacePath),
                    icon: <FolderOpen size={14} />,
                    onClick: () => switchWorkspace(w.workspacePath),
                  }))
                  : [{ label: 'No other recent workspaces', disabled: true, onClick: () => undefined }]);
              }}
            >
              <span className="truncate">{workspaceBaseName(workspacePath)}</span>
              <ChevronDown size={12} className="text-(--sg-text-faint) shrink-0 opacity-60 group-hover/switcher:opacity-100" />
            </button>
            <ChevronRight size={12} className="text-(--sg-text-faint) shrink-0" />
            <span className="flex items-center gap-1 font-mono text-xs text-(--sg-primary) truncate max-w-50">
              <GitBranch size={12} className="shrink-0" />
              {activeWorktree?.branch ?? (activeWorktree?.detached ? 'detached' : '—')}
            </span>
          </div>
          <div className="flex items-center h-full pr-1 gap-0.5 shrink-0" style={{ WebkitAppRegion: 'no-drag' } as React.CSSProperties}>
            <UpdateBadge state={updateState} onInstall={() => void api.installUpdate()} />
            <button className="inline-flex items-center justify-center p-2 bg-transparent border-none cursor-pointer text-(--sg-text-faint) rounded-sm transition-colors hover:text-(--sg-text) hover:bg-(--sg-surface-raised)" title="New Window" onClick={() => void api.openNewWindow()}>
              <AppWindow size={16} />
            </button>
            <button className="inline-flex items-center justify-center p-2 bg-transparent border-none cursor-pointer text-(--sg-text-faint) rounded-sm transition-colors hover:text-(--sg-text) hover:bg-(--sg-surface-raised)" title="Settings" onClick={() => void navigate({ to: '/settings', search: { workspace: workspacePath } })}>
              <Settings size={16} />
            </button>
          </div>
          <WindowControls side="right" />
        </header>

        {/* ── Body: sidebar + main content ── */}
        <div className="flex flex-1 min-h-0 overflow-hidden">
          {/* Worktree sidebar */}
          <WorktreeSidebar
            workspacePath={workspacePath}
            worktrees={worktrees}
            activeWorktree={activeWorktree}
            workspaceStatus={workspaceStatus ?? null}
            worktreeChangeCounts={worktreeChangeCounts}
            fetching={fetching}
            pulling={pulling}
            pushing={pushing}
            creatingWorktree={creatingWorktree}
            pendingCreationBranch={pendingCreationBranch}
            updateState={updateState}
            collapsed={sidebarCollapsed}
            onToggleCollapsed={() => setSidebarCollapsed(v => !v)}
            onWorktreeSwitch={wt => void handleWorktreeSwitch(wt)}
            onFetch={() => void doFetch()}
            onPull={() => void doPull()}
            onPush={() => void doPush()}
            onRefresh={() => {
              void qc.invalidateQueries({ queryKey: qk.worktrees(gitRepoPath) });
              void qc.invalidateQueries({ queryKey: qk.commits(gitRepoPath) });
              void qc.invalidateQueries({ queryKey: qk.refs(gitRepoPath) });
              if (activeWorktree) void qc.invalidateQueries({ queryKey: qk.pushStatus(activeWorktree.path) });
            }}
            onNewWorktree={() => setShowNewWorktree(true)}
            onOpenTerminal={(cwd, label) => void openTerminal(cwd, label)}
            onOpenHooksModal={() => setHooksModalOpen(true)}
            onOpenRunHookModal={wt => setRunHookTarget(wt)}
            onRunCreateHooks={wt => void runCreateHooksFor(wt)}
            onDeleteWorktree={wt => setDeleteTarget(wt)}
            agentConfigured={agentConfigured}
            worktreesWithLiveAgent={worktreesWithLiveAgent}
            onLaunchAgent={wtPath => void launchAgent(wtPath)}
          />

          {/* Main content */}
          <div className="flex-1 flex flex-col overflow-hidden">
            {/* Tab bar */}
            <div className="flex items-center border-b border-(--sg-border) bg-(--sg-surface) shrink-0 h-(--sg-toolbar-height)">
              <button
                className={tabCls(activeTab === 'graph')}
                onClick={() => useWorkspaceStore.setState({ activeTab: 'graph' })}
              >
                <GitBranch size={12} /> Graph
              </button>
              <button
                className={tabCls(activeTab === 'staging', !activeWorktree)}
                onClick={() => {
                  if (!activeWorktree) return;
                  useWorkspaceStore.setState({ activeTab: 'staging' });
                  // Force a fresh git status whenever the user clicks Changes,
                  // so newly-written files are always visible without a watcher event.
                  setStagingRefresh(n => n + 1);
                }}
                disabled={!activeWorktree}
              >
                <GitMerge size={12} /> Changes
                {activeWorktree && (worktreeChangeCounts[activeWorktree.path] ?? 0) > 0 && (
                  <span className="ml-1 rounded-full bg-(--sg-warning)/20 px-1.5 py-0 text-[9px] leading-4 font-semibold text-(--sg-warning)">
                    {worktreeChangeCounts[activeWorktree.path]}
                  </span>
                )}
              </button>
              <button
                className={tabCls(activeTab === 'terminal', !activeWorktree)}
                onClick={() => {
                  if (!activeWorktree) return;
                  if (visibleSessions.length === 0) {
                    void openTerminal(activeWorktree.path);
                  } else {
                    useWorkspaceStore.setState({ activeTab: 'terminal' });
                  }
                }}
                disabled={!activeWorktree}
              >
                <Terminal size={12} /> Terminal{visibleSessions.length > 1 ? ` (${visibleSessions.length})` : ''}
              </button>
              {agentConfig?.mode === 'integrated' && (
                <button
                  className={tabCls(activeTab === 'chat', !activeWorktree)}
                  onClick={() => {
                    if (!activeWorktree) return;
                    useWorkspaceStore.setState({ activeTab: 'chat' });
                  }}
                  disabled={!activeWorktree}
                  data-testid="tab-chat"
                >
                  <Bot size={12} /> Chat
                </button>
              )}
              <button
                className={tabCls(activeTab === 'files', !activeWorktree)}
                onClick={() => {
                  if (!activeWorktree) return;
                  useWorkspaceStore.setState({ activeTab: 'files' });
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
                  {activeTab === 'graph' && (
                    <div className="flex flex-col h-full">
                      <div className={selectedCommit ? 'h-1/2 min-h-0 overflow-hidden flex flex-col' : 'flex-1 min-h-0 overflow-hidden flex flex-col'}>
                        <CommitGraph
                          commits={commits}
                          worktrees={worktrees}
                          activeWorktree={activeWorktree}
                          hasMore={commits.length < commitTotal}
                          loadingMore={commitsFetching && commits.length > 0}
                          onLoadMore={async () => {
                            const more = await api.getCommitGraph({
                              repoPath: gitRepoPath,
                              limit: 500,
                              skip: commits.length,
                            }) as CommitEntry[];
                            qc.setQueryData<CommitEntry[]>(qk.commits(gitRepoPath), prev => [
                              ...(prev ?? []),
                              ...more,
                            ]);
                          }}
                          onSelect={selected => {
                            const nextSelectionKey = selected.map(c => c.hash).join(',');
                            const currentSelectionKey = selectedCommits.map(c => c.hash).join(',');
                            if (nextSelectionKey === currentSelectionKey) {
                              return;
                            }
                            if (selected.length === 1 && selected[0]) {
                              void loadCommitDiff(selected[0]);
                            } else if (selected.length === 2 && selected[0] && selected[1]) {
                              void loadCommitRangeDiff(selected[0], selected[1]);
                            } else {
                              setSelectedCommits([]);
                              setCommitDiffFiles([]);
                              setCommitDiffContent('');
                              setCommitDiffFile(null);
                            }
                          }}
                          onCreateWorktree={() => {
                            setShowNewWorktree(true);
                          }}
                          onCheckout={ref => {
                            if (activeWorktree) {
                              void api.checkout(activeWorktree.path, ref)
                                .then(() => {
                                  toast('Checked out', 'success');
                                  void qc.invalidateQueries({ queryKey: qk.commits(gitRepoPath) });
                                  void qc.invalidateQueries({ queryKey: qk.refs(gitRepoPath) });
                                })
                                .catch((err: unknown) => toast(String(err), 'error'));
                            }
                          }}
                          onReset={(ref, mode) => {
                            if (activeWorktree) {
                              void api.reset(activeWorktree.path, ref, mode)
                                .then(() => {
                                  toast(`Reset (${mode}) complete`, 'success');
                                  void qc.invalidateQueries({ queryKey: qk.commits(gitRepoPath) });
                                  void qc.invalidateQueries({ queryKey: qk.refs(gitRepoPath) });
                                })
                                .catch((err: unknown) => toast(String(err), 'error'));
                            }
                          }}
                          issueTrackerPatterns={issueTrackerPatterns}
                        />
                      </div>
                      {selectedCommit && (
                        <CommitDiffPanel
                          commit={selectedCommit}
                          files={commitDiffFiles}
                          loading={commitDiffLoading}
                          selectedFile={commitDiffFile}
                          diffContent={commitDiffContent}
                          issueTrackerPatterns={issueTrackerPatterns}
                          diffLoading={commitDiffFileLoading}
                          onSelectFile={f => void loadCommitDiffFile(f)}
                          onClose={() => {
                            setSelectedCommits([]);
                            setCommitDiffFiles([]);
                            setCommitDiffContent('');
                            setCommitDiffFile(null);
                          }}
                        />
                      )}
                    </div>
                  )}

                  {/* Staging tab */}
                  {activeTab === 'staging' && activeWorktree && (
                    <StagingPanel
                      worktreePath={activeWorktree.path}
                      branch={activeWorktree.branch ?? null}
                      refreshSignal={stagingRefresh}
                      getStatus={p => api.getStatus(p)}
                      stageFiles={(p, paths) => api.stageFiles(p, paths)}
                      unstageFiles={(p, paths) => api.unstageFiles(p, paths)}
                      createCommit={(p, msg) => api.createCommit(p, msg)}
                      getDiff={(p, staged, file) =>
                        staged
                          ? api.getDiffContent(p, 'HEAD', file)
                          : api.getWorkingDiff(p, file)
                      }
                      generateCommitMessage={async p => {
                        const settings = await loadCommitMessageGeneratorSettings();
                        return api.generateCommitMessage({ workspacePath, worktreePath: p, settings });
                      }}
                      onCommit={() => {
                        toast('Committed', 'success');
                        setStagingRefresh(n => n + 1);
                        void qc.invalidateQueries({ queryKey: qk.commits(gitRepoPath) });
                        void qc.invalidateQueries({ queryKey: qk.commitCount(gitRepoPath) });
                        void qc.invalidateQueries({ queryKey: qk.refs(gitRepoPath) });
                        if (activeWorktree) void qc.invalidateQueries({ queryKey: qk.worktreeStatus(activeWorktree.path) });
                      }}
                      onClose={() => useWorkspaceStore.setState({ activeTab: 'graph' })}
                      onToast={(msg, v) => toast(msg, v)}
                    />
                  )}

                  {/* Terminal tab */}
                  {activeTab === 'terminal' && activeWorktree && (
                    <div className="flex flex-col h-full">
                      <div className="flex min-h-8 shrink-0 items-center gap-1 border-b border-(--sg-border) bg-(--sg-bg) px-1.5">
                        <div className="flex min-w-0 flex-1 items-center gap-0.5 overflow-x-auto py-0.5" role="tablist" aria-label="Terminal sessions">
                          {visibleSessions.map(s => {
                            const isActive = s.id === activeTerminalId;
                            const isRenaming = s.id === renamingTerminalId;
                            return (
                              <div
                                key={s.id}
                                className={`group relative flex shrink-0 items-center overflow-hidden rounded ${isActive ? 'bg-(--sg-surface-raised)' : 'hover:bg-(--sg-surface)'}`}
                                onContextMenu={e => openTerminalTabMenu(e, s.id)}
                              >
                                {isActive && <span className="pointer-events-none absolute inset-x-1 bottom-0 h-0.5 rounded-t-full bg-(--sg-primary) shadow-[0_0_6px_var(--sg-primary)]" />}
                                {isRenaming ? (
                                  <input
                                    ref={renameInputRef}
                                    data-testid="input-rename-terminal"
                                    type="text"
                                    value={renameValue}
                                    onChange={e => setRenameValue(e.target.value)}
                                    onBlur={commitTerminalRename}
                                    onKeyDown={e => {
                                      if (e.key === 'Enter') commitTerminalRename();
                                      if (e.key === 'Escape') cancelTerminalRename();
                                      e.stopPropagation();
                                    }}
                                    onClick={e => e.stopPropagation()}
                                    className="min-w-0 w-25 rounded bg-(--sg-input-bg) px-2 py-1 text-[11px] font-medium text-(--sg-text) outline-(--sg-primary)"
                                  />
                                ) : (
                                  <button
                                    data-testid="terminal-session-tab"
                                    data-session-label={s.label}
                                    role="tab"
                                    aria-selected={isActive}
                                    className={`flex items-center gap-1.5 px-2.5 py-1 text-[11px] font-medium ${isActive ? 'text-(--sg-primary)' : 'text-(--sg-text)'}`}
                                    onClick={() => useWorkspaceStore.setState({ activeTerminalId: s.id, activeTab: 'terminal' })}
                                  >
                                    <span className={`h-1.5 w-1.5 shrink-0 rounded-full ${isActive ? 'bg-(--sg-primary)' : 'bg-(--sg-text-faint)'}`} />
                                    <span className="max-w-35 truncate">{s.label}</span>
                                  </button>
                                )}
                                <button
                                  className="flex items-center px-1.5 py-1.5 text-(--sg-text-dim) transition-colors hover:text-(--sg-danger)"
                                  title={`Close ${s.label}`}
                                  onClick={e => {
                                    e.stopPropagation();
                                    void closeTerminal(s.id);
                                  }}
                                >
                                  <X size={10} />
                                </button>
                              </div>
                            );
                          })}
                        </div>
                        <div className="relative inline-flex shrink-0 items-stretch rounded bg-(--sg-bg)">
                          <button
                            data-testid="btn-add-terminal"
                            title="New terminal"
                            className="flex items-center rounded-l px-2 py-1 text-(--sg-text-faint) transition-colors hover:bg-(--sg-surface-raised) hover:text-(--sg-text-dim)"
                            onClick={() => void openTerminal(activeWorktree?.path ?? workspacePath)}
                          >
                            <Plus size={13} />
                          </button>
                          {availableShells.length > 0 && (
                            <button
                              title="Choose shell"
                              className="flex items-center rounded-r px-1 py-1 text-(--sg-text-faint) transition-colors hover:bg-(--sg-surface-raised) hover:text-(--sg-text-dim)"
                              onClick={() => setShowShellPicker(v => !v)}
                            >
                              <ChevronDown size={10} />
                            </button>
                          )}
                          {showShellPicker && availableShells.length > 0 && (
                            <>
                              <div className="fixed inset-0 z-40" onClick={() => setShowShellPicker(false)} />
                              <div className="absolute top-full right-0 z-50 mt-1 min-w-32.5 overflow-hidden rounded-md border border-(--sg-border) bg-(--sg-surface) py-1 shadow-xl">
                                {availableShells.map(shell => (
                                  <button
                                    key={shell.path}
                                    className="flex w-full items-center gap-2 px-3 py-1.5 text-left text-xs text-(--sg-text) transition-colors hover:bg-(--sg-surface-raised)"
                                    onClick={() => {
                                      setShowShellPicker(false);
                                      void openTerminal(activeWorktree?.path ?? workspacePath, undefined, shell.path);
                                    }}
                                  >
                                    {shell.name}
                                  </button>
                                ))}
                              </div>
                            </>
                          )}
                        </div>
                        <div className="mx-0.5 h-3.5 w-px bg-(--sg-border)" />
                        <div className="flex shrink-0 items-center gap-0.5 py-0.5">
                          <button
                            title="Tabbed"
                            className={`rounded p-1 transition-colors ${terminalLayout === 'tabs' ? 'bg-(--sg-surface-raised) text-(--sg-primary)' : 'text-(--sg-text-faint) hover:bg-(--sg-surface-raised) hover:text-(--sg-text-dim)'}`}
                            onClick={() => useWorkspaceStore.setState({ terminalLayout: 'tabs' })}
                          >
                            <Rows3 size={14} />
                          </button>
                          <button
                            title="Split"
                            className={`rounded p-1 transition-colors ${terminalLayout === 'split' ? 'bg-(--sg-surface-raised) text-(--sg-primary)' : 'text-(--sg-text-faint) hover:bg-(--sg-surface-raised) hover:text-(--sg-text-dim)'}`}
                            onClick={() => useWorkspaceStore.setState({ terminalLayout: 'split' })}
                          >
                            <Columns2 size={14} />
                          </button>
                          <button
                            title="Grid"
                            className={`rounded p-1 transition-colors ${terminalLayout === 'grid' ? 'bg-(--sg-surface-raised) text-(--sg-primary)' : 'text-(--sg-text-faint) hover:bg-(--sg-surface-raised) hover:text-(--sg-text-dim)'}`}
                            onClick={() => useWorkspaceStore.setState({ terminalLayout: 'grid' })}
                          >
                            <LayoutGrid size={14} />
                          </button>
                        </div>
                      </div>
                      <div className={terminalWrapperClass()}>
                        {visibleSessions.map(s => (
                          <div
                            key={s.id}
                            className={`h-full min-h-0 min-w-0 ${terminalLayout !== 'tabs' ? 'border-r border-(--sg-border) last:border-r-0 nth-[2n]:border-r-0 nth-[n+3]:border-t nth-[n+3]:border-(--sg-border)' : ''}`}
                            style={terminalPanelStyle(s.id)}
                          >
                            <TerminalPane
                              sessionId={s.id}
                              incomingData={s.pendingData}
                              className="h-full w-full"
                              // High-frequency (every keystroke/resize) — a toast per
                              // failure would be spam, so this is intentionally silent
                              // beyond swallowing the rejection to avoid unhandled-
                              // rejection console noise if the PTY session has died.
                              onData={(id, data) => { void api.writeTerminal(id, data).catch(() => undefined); }}
                              onResize={(id, cols, rows) => { void api.resizeTerminal(id, cols, rows).catch(() => undefined); }}
                            />
                          </div>
                        ))}
                      </div>
                    </div>
                  )}

                  {/* Chat tab (Integrated AI agent mode) */}
                  {activeTab === 'chat' && activeWorktree && agentConfig?.mode === 'integrated' && (
                    <ChatPanel worktreePath={activeWorktree.path} />
                  )}

                  {/* Files tab */}
                  {activeTab === 'files' && activeWorktree && (
                    <div className="flex h-full">
                      <div className="w-56 shrink-0 border-r border-(--sg-border)">
                        <FileTreePanel
                          tree={fileTree}
                          loading={fileTreeLoading}
                          activeRelativePath={activeEditorTab?.relativePath ?? null}
                          onOpenFile={rel => void openFile(rel)}
                          onRefresh={() => void qc.invalidateQueries({ queryKey: qk.fileTree(activeWorktree.path) })}
                        />
                      </div>
                      <div className="min-w-0 flex-1">
                        <FileEditorPanel
                          tabs={editorTabsForActiveWorktree}
                          activeTabKey={editorActiveTabKey}
                          keyOf={t => tabKey(t.worktreePath, t.relativePath)}
                          onSelectTab={key => setActiveEditorTab(key)}
                          onCloseTab={key => closeEditorTab(key)}
                          onChange={(key, content) => setTabContent(key, content)}
                          onSave={key => void saveFile(key)}
                          onReloadFromDisk={key => void reloadFileFromDisk(key)}
                          onKeepMine={key => resolveConflictKeepMine(key)}
                        />
                      </div>
                    </div>
                  )}
                </>
              )}
            </div>
          </div>
        </div>{/* end body */}
      </div>

      {/* Hooks settings modal */}
      <WorkspaceHooksModal
        open={hooksModalOpen}
        workspacePath={workspacePath}
        worktreePath={activeWorktree?.path ?? null}
        onClose={() => setHooksModalOpen(false)}
        {...(defaultShell ? { defaultShell } : {})}
        api={{
          listHooks: (p, wt) => api.listHooks(p, wt),
          createHook: args => api.createHook(args),
          updateHook: args => api.updateHook(args),
          deleteHook: (p, id) => api.deleteHook(p, id),
          toggleHook: (p, id, enabled) => api.toggleHook(p, id, enabled),
          trustHook: (wt, hookId) => api.trustHook(wt, hookId),
        }}
      />

      {/* New worktree dialog */}
      <NewWorktreeDialog
        open={showNewWorktree}
        workspacePath={workspacePath}
        gitRepoPath={gitRepoPath}
        managedWorktreesPath={workspaceStatus?.worktreesPath ?? ''}
        refs={refs}
        issueTrackerPatterns={issueTrackerPatterns}
        initiatingWorktreePath={activeWorktree?.path ?? null}
        onClose={() => setShowNewWorktree(false)}
        onCreated={(newWorktreePath) => {
          // Hooks (before/after_worktree_create) and issue-ref provenance now
          // run server-side as part of the worktree:create IPC call itself
          // (see app/src/main/worktree-lifecycle.ts) — the only thing left
          // for the renderer to do here is its own UI-state bookkeeping.
          setPendingNewWorktreePath(newWorktreePath);
          void qc.invalidateQueries({ queryKey: qk.worktrees(gitRepoPath) });
          void qc.invalidateQueries({ queryKey: qk.refs(gitRepoPath) });
        }}
        onToast={(msg, v) => toast(msg, v)}
      />

      {/* Publish branch dialog */}
      <PublishDialog
        open={showPublishModal}
        activeWorktree={activeWorktree}
        pushStatus={pushStatus ?? null}
        onClose={() => setShowPublishModal(false)}
        onToast={(msg, v) => toast(msg, v)}
        onPublished={() => activeWorktree && void qc.invalidateQueries({ queryKey: qk.pushStatus(activeWorktree.path) })}
      />

      {/* Run hook dialog */}
      <RunHookDialog
        target={runHookTarget}
        workspacePath={workspacePath}
        activeWorktreePath={activeWorktree?.path ?? null}
        onClose={() => setRunHookTarget(null)}
        onToast={(msg, v) => toast(msg, v)}
      />

      {/* Delete worktree dialog */}
      <DeleteWorktreeDialog
        target={deleteTarget}
        loading={deleteWorktreeMutation.isPending}
        onConfirm={wt => void doDeleteWorktree(wt)}
        onCancel={() => setDeleteTarget(null)}
      />
    </>
  );
}

export const workspaceRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/workspace',
  validateSearch: (search: Record<string, unknown>): WorkspaceSearch => ({
    path: typeof search['path'] === 'string' ? search['path'] : '',
  }),
  component: WorkspaceView,
});
