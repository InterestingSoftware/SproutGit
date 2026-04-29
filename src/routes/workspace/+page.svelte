<script lang="ts">
  import { onDestroy } from 'svelte';
  import { goto } from '$app/navigation';
  import { page } from '$app/stores';
  import Autocomplete from '$lib/components/Autocomplete.svelte';
  import CommitGraph from '$lib/components/CommitGraph.svelte';
  import ConfirmDialog from '$lib/components/ConfirmDialog.svelte';
  import ContextMenu, { type MenuItem } from '$lib/components/ContextMenu.svelte';
  import DiffViewer from '$lib/components/DiffViewer.svelte';
  import Spinner from '$lib/components/Spinner.svelte';
  import TerminalContainer from '$lib/components/TerminalContainer.svelte';
  import WorkspaceHooksModal from '$lib/components/WorkspaceHooksModal.svelte';
  import {
    checkoutWorktree,
    createManagedWorktree,
    deleteManagedWorktree,
    getCommitGraph,
    countCommits,
    getDiffContent,
    getDiffFiles,
    inspectWorkspace,
    listWorkspaceHooks,
    listRefs,
    listWorktrees,
    openInEditor,
    onHookProgress,
    onHookTerminalLaunch,
    resetWorktreeBranch,
    runWorkspaceHook,
    getWorktreeStatus,
    getWorkingDiff,
    stageFiles,
    unstageFiles,
    createCommit,
    startWatchingWorktrees,
    stopWatchingWorktrees,
    onWorktreeChanged,
    getAppSetting,
    listAvailableShells,
    type StatusFileEntry,
    type WorktreeStatusResult,
    type CommitEntry,
    type CommitGraphResult,
    type DiffFileEntry,
    type RefInfo,
    type HookProgressEvent,
    type HookTerminalLaunchEvent,
    type WorkspaceHook,
    type WorkspaceHookTrigger,
    type WorkspaceStatus,
    type WorktreeInfo,
  } from '$lib/sproutgit';
  import { toast } from '$lib/toast.svelte';
  import { tildify } from '$lib/paths.svelte';
  import { findPath, normalizePathSeparators, pathsEqual } from '$lib/path-utils';
  import { validateBranchName, validateSourceRef } from '$lib/validation';
  import { openPath } from '@tauri-apps/plugin-opener';
  import { FolderOpen, Play, Trash2, SquareTerminal, ShieldAlert, Settings } from 'lucide-svelte';
  import WindowControls from '$lib/components/WindowControls.svelte';
  import UpdateBadge from '$lib/components/UpdateBadge.svelte';

  const GRAPH_PAGE_SIZE = 2000;

  let workspace = $state<WorkspaceStatus | null>(null);
  let worktrees = $state<WorktreeInfo[]>([]);
  let graph = $state<CommitGraphResult | null>(null);
  let refs = $state<RefInfo[]>([]);
  let selectedRef = $state('');
  let newBranch = $state('');
  let activeWorktreePath = $state<string | null>(null);
  let graphSkip = $state(0);
  let graphHasMore = $state(false);
  let graphLoadingMore = $state(false);
  let totalCommitCount = $state<number | null>(null);
  let graphSeenHashes = new Set<string>();
  let graphGeneration = 0;
  let loading = $state(true);
  let creating = $state(false);
  let deleting = $state<string | null>(null);
  let error = $state('');

  // Confirm dialog state
  type ConfirmState = {
    title: string;
    message: string;
    confirmLabel: string;
    danger: boolean;
    onconfirm: () => void;
  } | null;
  let confirmDialog = $state<ConfirmState>(null);
  let actionRef = $state('');
  let formTouched = $state({ branch: false, ref: false });

  // Diff viewer state
  let selectedCommits = $state<CommitEntry[]>([]);
  let diffFiles = $state<DiffFileEntry[]>([]);
  let diffContent = $state('');
  let diffSelectedFile = $state<string | null>(null);
  let diffLoading = $state(false);

  // Worktree context menu
  let worktreeContextMenu = $state<{ x: number; y: number; items: MenuItem[] } | null>(null);
  let hooksModalOpen = $state(false);
  let operationStatus = $state<{ title: string; detail: string } | null>(null);
  let operationError = $state<string | null>(null);
  let activeHookName = $state<string | null>(null);
  let operationLogs = $state<string[]>([]);
  let operationCompleted = $state(false);

  type OperationHookStatus = 'pending' | 'running' | 'success' | 'skipped' | 'timed_out' | 'error';
  type OperationHookState = {
    id: string;
    name: string;
    trigger: string;
    status: OperationHookStatus;
    keepOpenOnCompletion: boolean;
    logs: string[];
  };

  let operationHooks = $state<OperationHookState[]>([]);

  const shouldKeepOperationOpen = $derived(operationHooks.some(hook => hook.keepOpenOnCompletion));

  const hookStatusSummary = $derived.by(() => {
    const summary = {
      pending: 0,
      running: 0,
      success: 0,
      skipped: 0,
      timed_out: 0,
      error: 0,
    };

    for (const hook of operationHooks) {
      summary[hook.status] += 1;
    }

    return summary;
  });

  function statusLabel(status: OperationHookStatus): string {
    switch (status) {
      case 'pending':
        return 'Pending';
      case 'running':
        return 'Running';
      case 'success':
        return 'Complete';
      case 'skipped':
        return 'Skipped';
      case 'timed_out':
        return 'Timed out';
      case 'error':
        return 'Error';
      default:
        return status;
    }
  }

  function statusBadgeClass(status: OperationHookStatus): string {
    switch (status) {
      case 'pending':
        return 'border-[var(--sg-border)] bg-[var(--sg-surface-raised)] text-[var(--sg-text-faint)]';
      case 'running':
        return 'border-[var(--sg-accent)]/40 bg-[var(--sg-accent)]/15 text-[var(--sg-accent)]';
      case 'success':
        return 'border-[var(--sg-primary)]/40 bg-[var(--sg-primary)]/15 text-[var(--sg-primary)]';
      case 'skipped':
        return 'border-[var(--sg-warning)]/40 bg-[var(--sg-warning)]/15 text-[var(--sg-warning)]';
      case 'timed_out':
        return 'border-[var(--sg-danger)]/40 bg-[var(--sg-danger)]/15 text-[var(--sg-danger)]';
      case 'error':
        return 'border-[var(--sg-danger)]/40 bg-[var(--sg-danger)]/15 text-[var(--sg-danger)]';
      default:
        return 'border-[var(--sg-border)] bg-[var(--sg-surface-raised)] text-[var(--sg-text-faint)]';
    }
  }

  function mapEventStatus(event: HookProgressEvent): OperationHookStatus {
    if (event.phase === 'start') return 'running';
    if (event.phase === 'skipped') return 'skipped';
    if (event.status === 'success') return 'success';
    if (event.status === 'timed_out') return 'timed_out';
    return 'error';
  }

  function updateHookState(
    hookId: string,
    updater: (current: OperationHookState) => OperationHookState
  ) {
    const idx = operationHooks.findIndex(hook => hook.id === hookId);
    if (idx < 0) return;
    const current = operationHooks[idx];
    const next = updater(current);
    operationHooks = [...operationHooks.slice(0, idx), next, ...operationHooks.slice(idx + 1)];
  }

  function ensureHookState(event: HookProgressEvent): OperationHookState {
    const existing = operationHooks.find(hook => hook.id === event.hookId);
    if (existing) return existing;

    const created: OperationHookState = {
      id: event.hookId,
      name: event.hookName,
      trigger: event.trigger,
      status: 'pending',
      keepOpenOnCompletion: event.keepOpenOnCompletion ?? false,
      logs: [],
    };

    operationHooks = [...operationHooks, created];
    return created;
  }

  function appendOperationLog(line: string) {
    operationLogs = [...operationLogs, line];
  }

  function toOperationHookState(
    hook: Pick<WorkspaceHook, 'id' | 'name' | 'trigger' | 'keepOpenOnCompletion'>
  ): OperationHookState {
    return {
      id: hook.id,
      name: hook.name,
      trigger: hook.trigger,
      status: 'pending',
      keepOpenOnCompletion: hook.keepOpenOnCompletion,
      logs: [],
    };
  }

  function sortHooksByTriggerAndName<T extends { trigger: string; name: string }>(hooks: T[]): T[] {
    return [...hooks].sort((a, b) => {
      if (a.trigger !== b.trigger) return a.trigger.localeCompare(b.trigger);
      return a.name.localeCompare(b.name);
    });
  }

  function slugifyForPath(name: string): string {
    let output = '';
    let previousDash = false;

    for (const ch of name) {
      const isWord = /[A-Za-z0-9_-]/.test(ch);
      if (isWord) {
        output += ch.toLowerCase();
        previousDash = false;
      } else if (!previousDash) {
        output += '-';
        previousDash = true;
      }
    }

    return output.replace(/^-+|-+$/g, '');
  }

  function isWorkspaceStatus(value: WorkspaceStatus | null | undefined): value is WorkspaceStatus {
    return Boolean(
      value &&
      typeof value.workspacePath === 'string' &&
      typeof value.rootPath === 'string' &&
      typeof value.isSproutgitProject === 'boolean'
    );
  }

  async function inspectWorkspaceWithRetry(workspacePath: string): Promise<WorkspaceStatus> {
    let lastError: unknown = null;

    for (let attempt = 0; attempt < 3; attempt += 1) {
      try {
        const status = await inspectWorkspace(workspacePath);
        if (isWorkspaceStatus(status)) {
          return status;
        }
      } catch (err) {
        lastError = err;
      }

      await new Promise(resolveDelay => setTimeout(resolveDelay, 150 * (attempt + 1)));
    }

    if (lastError) {
      throw new Error(`Workspace inspection failed after retries: ${String(lastError)}`);
    }

    throw new Error('Workspace inspection returned an invalid result after retries.');
  }

  function isWorktreeListResult(
    value: { repoPath?: string; worktrees?: WorktreeInfo[] } | null | undefined
  ): value is { repoPath: string; worktrees: WorktreeInfo[] } {
    return Boolean(value && typeof value.repoPath === 'string' && Array.isArray(value.worktrees));
  }

  function isRefsResult(
    value: { repoPath?: string; refs?: RefInfo[] } | null | undefined
  ): value is { repoPath: string; refs: RefInfo[] } {
    return Boolean(value && typeof value.repoPath === 'string' && Array.isArray(value.refs));
  }

  function isCommitGraphResult(
    value: CommitGraphResult | null | undefined
  ): value is CommitGraphResult {
    return Boolean(value && typeof value.repoPath === 'string' && Array.isArray(value.commits));
  }

  async function readWithRetry<T>(
    reader: () => Promise<T>,
    isValid: (value: T | null | undefined) => boolean,
    label: string
  ): Promise<T> {
    let lastError: unknown = null;

    for (let attempt = 0; attempt < 10; attempt += 1) {
      try {
        const result = await reader();
        if (isValid(result)) {
          return result;
        }
      } catch (err) {
        lastError = err;
      }

      await new Promise(resolveDelay => setTimeout(resolveDelay, 150));
    }

    if (lastError) {
      throw new Error(`${label} failed after retries: ${String(lastError)}`);
    }

    throw new Error(`${label} returned an invalid result after retries.`);
  }

  function readWorkspaceHint(workspacePath: string): WorkspaceStatus | null {
    const raw = sessionStorage.getItem('sg_workspace_hint');
    if (!raw) return null;

    try {
      const parsed = JSON.parse(raw) as WorkspaceStatus | null;
      if (!isWorkspaceStatus(parsed)) return null;
      return parsed.workspacePath === workspacePath ? parsed : null;
    } catch {
      return null;
    }
  }

  function collectHookClosure(allHooks: WorkspaceHook[], rootHookId: string): WorkspaceHook[] {
    const hooksById = new Map(allHooks.map(hook => [hook.id, hook]));
    const collectedIds = new Set<string>();

    function visit(hookId: string) {
      if (collectedIds.has(hookId)) return;
      const hook = hooksById.get(hookId);
      if (!hook) return;
      collectedIds.add(hookId);
      for (const dependencyId of hook.dependencyIds) {
        visit(dependencyId);
      }
    }

    visit(rootHookId);

    return sortHooksByTriggerAndName(
      Array.from(collectedIds)
        .map(hookId => hooksById.get(hookId))
        .filter((hook): hook is WorkspaceHook => Boolean(hook))
    );
  }

  async function beginOperation(
    title: string,
    detail: string,
    triggers: WorkspaceHookTrigger[] = [],
    preloadedHooks: Array<
      Pick<WorkspaceHook, 'id' | 'name' | 'trigger' | 'keepOpenOnCompletion'>
    > = []
  ) {
    operationStatus = { title, detail };
    operationError = null;
    operationCompleted = false;
    activeHookName = null;
    operationLogs = [];
    operationHooks = [];

    if (preloadedHooks.length > 0) {
      operationHooks = sortHooksByTriggerAndName(preloadedHooks).map(toOperationHookState);
      return;
    }

    if (!workspace || triggers.length === 0) return;
    const workspacePath = workspace.workspacePath;

    try {
      const hookLists = await Promise.all(
        triggers.map(async trigger => {
          const hooks = await listWorkspaceHooks(workspacePath, trigger);
          return Array.isArray(hooks) ? hooks.filter(hook => hook.enabled) : [];
        })
      );

      const seen = new Set<string>();
      const hooks: Array<Pick<WorkspaceHook, 'id' | 'name' | 'trigger' | 'keepOpenOnCompletion'>> =
        [];

      for (const triggerHooks of hookLists) {
        for (const hook of triggerHooks) {
          if (seen.has(hook.id)) continue;
          seen.add(hook.id);
          hooks.push({
            id: hook.id,
            name: hook.name,
            trigger: hook.trigger,
            keepOpenOnCompletion: hook.keepOpenOnCompletion,
          });
        }
      }

      operationHooks = sortHooksByTriggerAndName(hooks).map(toOperationHookState);
    } catch (err) {
      appendOperationLog(`Failed to preload hook list: ${err}`);
    }
  }

  function failOperation(message: string) {
    operationError = message;
    appendOperationLog(`Operation error: ${message}`);
  }

  function endOperation(force = false) {
    if (force) {
      operationStatus = null;
      operationError = null;
      operationCompleted = false;
      activeHookName = null;
      operationHooks = [];
      return;
    }

    if (operationError) return;

    if (shouldKeepOperationOpen) {
      operationCompleted = true;
      activeHookName = null;
      return;
    }

    operationStatus = null;
    operationError = null;
    operationCompleted = false;
    activeHookName = null;
    operationHooks = [];
  }

  function handleHookProgress(event: HookProgressEvent) {
    if (!operationStatus) return;

    ensureHookState(event);
    const nextStatus = mapEventStatus(event);

    if (event.phase === 'start') {
      activeHookName = event.hookName;
      appendOperationLog(`▶ ${event.hookName} (${event.trigger})`);
      updateHookState(event.hookId, current => ({
        ...current,
        name: event.hookName,
        trigger: event.trigger,
        keepOpenOnCompletion: event.keepOpenOnCompletion ?? current.keepOpenOnCompletion,
        status: nextStatus,
        logs: [...current.logs, 'Started'],
      }));
      return;
    }

    if (event.phase === 'skipped') {
      appendOperationLog(`⏭ ${event.hookName} skipped`);
      updateHookState(event.hookId, current => ({
        ...current,
        name: event.hookName,
        trigger: event.trigger,
        keepOpenOnCompletion: event.keepOpenOnCompletion ?? current.keepOpenOnCompletion,
        status: nextStatus,
        logs: event.errorMessage
          ? [...current.logs, `Skipped: ${event.errorMessage}`]
          : [...current.logs, 'Skipped'],
      }));
      if (event.errorMessage?.trim()) {
        appendOperationLog(`  error: ${event.errorMessage}`);
      }
      return;
    }

    appendOperationLog(
      `${event.status === 'success' ? '✓' : '✗'} ${event.hookName} (${event.status})`
    );

    if (event.stdoutSnippet?.trim()) {
      appendOperationLog(`  stdout:\n${event.stdoutSnippet}`);
    }

    if (event.stderrSnippet?.trim()) {
      appendOperationLog(`  stderr:\n${event.stderrSnippet}`);
    }

    if (event.errorMessage?.trim()) {
      appendOperationLog(`  error: ${event.errorMessage}`);
    }

    const hookLogs: string[] = [];
    hookLogs.push(`Finished with status: ${event.status}`);
    if (event.stdoutSnippet?.trim()) {
      hookLogs.push(`stdout:\n${event.stdoutSnippet}`);
    }
    if (event.stderrSnippet?.trim()) {
      hookLogs.push(`stderr:\n${event.stderrSnippet}`);
    }
    if (event.errorMessage?.trim()) {
      hookLogs.push(`error: ${event.errorMessage}`);
    }

    updateHookState(event.hookId, current => ({
      ...current,
      name: event.hookName,
      trigger: event.trigger,
      keepOpenOnCompletion: event.keepOpenOnCompletion ?? current.keepOpenOnCompletion,
      status: nextStatus,
      logs: [...current.logs, ...hookLogs],
    }));

    if (activeHookName === event.hookName) {
      activeHookName = null;
    }
  }

  const branchError = $derived(validateBranchName(newBranch));
  const refError = $derived(validateSourceRef(selectedRef));
  const formValid = $derived(!branchError && !refError);

  const rootWorktree = $derived(
    worktrees.find(item => pathsEqual(item.path, workspace?.rootPath)) ?? null
  );

  const activeIsRoot = $derived(pathsEqual(activeWorktreePath, workspace?.rootPath));

  const nonRootWorktrees = $derived(
    worktrees.filter(item => !pathsEqual(item.path, workspace?.rootPath))
  );

  const selectedWorktree = $derived(
    worktrees.find(item => pathsEqual(item.path, activeWorktreePath)) ?? null
  );

  const refItems = $derived(refs.map(r => ({ label: r.name, value: r.name, detail: r.kind })));

  function initializeGraphState(nextGraph: CommitGraphResult) {
    graphGeneration += 1;
    graph = nextGraph;
    graphSkip = nextGraph.commits.length;
    graphHasMore = nextGraph.commits.length === GRAPH_PAGE_SIZE;
    graphSeenHashes = new Set(nextGraph.commits.map(commit => commit.hash));
  }

  // ── Staging/Unstaging State ──
  let worktreeStatus = $state<StatusFileEntry[]>([]);
  const stagedFiles = $derived(
    worktreeStatus.filter(f => f.indexStatus !== ' ' && f.indexStatus !== '?')
  );
  const unstagedFiles = $derived(worktreeStatus.filter(f => f.workTreeStatus !== ' '));
  let commitMessage = $state('');
  let statusLoading = $state(false);
  let stagingAction = $state<string | null>(null);
  let committing = $state(false);

  // ── Active tab ──────────────────────────────────────────────────────────────
  // Three tabs: 'history' | 'changes' | 'terminal'
  // Initialised from sessionStorage, with migration from the old boolean key.
  type WorkspaceTab = 'history' | 'changes' | 'terminal';
  let activeTab = $state<WorkspaceTab>(
    (() => {
      if (typeof sessionStorage === 'undefined') return 'history';
      const saved = sessionStorage.getItem('sg_active_tab');
      if (saved === 'history' || saved === 'changes' || saved === 'terminal') return saved;
      // Migrate from the old boolean sg_show_history key
      return sessionStorage.getItem('sg_show_history') === 'false' ? 'changes' : 'history';
    })()
  );

  // ── Terminal state ──────────────────────────────────────────────────────────
  let availableShells = $state<string[]>([]);
  let defaultShell = $state('');
  type HookTerminalLaunchRequest = {
    id: string;
    cwd: string;
    shell: string;
    label: string;
    command: string;
  };
  let hookTerminalLaunchRequest = $state<HookTerminalLaunchRequest | null>(null);
  // Paths whose terminal panel has been initialized at least once.
  // Once added, the TerminalPanel stays mounted (display:none when inactive)
  // so the PTY session survives tab switches and worktree switches.
  let terminalInitializedPaths = $state(new Set<string>());

  // Lazily initialize terminal for the active worktree the first time the tab is shown.
  $effect(() => {
    if (
      activeTab === 'terminal' &&
      defaultShell &&
      activeWorktreePath &&
      !pathsEqual(activeWorktreePath, workspace?.rootPath) &&
      !terminalInitializedPaths.has(activeWorktreePath)
    ) {
      terminalInitializedPaths = new Set([...terminalInitializedPaths, activeWorktreePath]);
    }
  });

  // Per-worktree change counts for sidebar badges
  let worktreeChangeCounts = $state<Record<string, number>>({});

  // ── Panel split state ──
  // Percentage (0–100) of the file-list area given to the unstaged panel.
  let splitPct = $state(50);
  let isSplitDragging = $state(false);
  let splitContainerEl = $state<HTMLElement | null>(null);

  function onSplitPointerDown(e: PointerEvent) {
    e.preventDefault();
    isSplitDragging = true;
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
  }

  function onSplitPointerMove(e: PointerEvent) {
    if (!isSplitDragging || !splitContainerEl) return;
    const rect = splitContainerEl.getBoundingClientRect();
    const raw = ((e.clientY - rect.top) / rect.height) * 100;
    splitPct = Math.min(85, Math.max(15, raw));
  }

  function onSplitPointerUp(e: PointerEvent) {
    isSplitDragging = false;
    (e.currentTarget as HTMLElement).releasePointerCapture(e.pointerId);
  }

  // ── Multi-select State ──
  // Keys are composite strings: "staged:<path>" or "unstaged:<path>".
  // This prevents the same filename appearing in both lists from being co-selected.
  let selectedFilePaths = $state<Set<string>>(new Set());
  let lastClickedKey = $state<string | null>(null);
  let isDragSelecting = $state(false);
  let dragStartKey = $state<string | null>(null);
  let didDragExpand = false; // non-reactive: set during drag, cleared in onclick
  const hasMultiSelection = $derived(selectedFilePaths.size > 1);
  // Ordered composite keys for range/drag selection spanning both sections.
  const allFileKeys = $derived([
    ...unstagedFiles.map(f => `unstaged:${f.path}`),
    ...stagedFiles.map(f => `staged:${f.path}`),
  ]);

  async function loadAllWorktreeChangeCounts(paths: string[]) {
    const results = await Promise.all(
      paths.map(async p => {
        try {
          const r = await getWorktreeStatus(p);
          return [p, r.files.length] as [string, number];
        } catch {
          return [p, 0] as [string, number];
        }
      })
    );
    worktreeChangeCounts = Object.fromEntries(results);
  }

  // ── Staging Diff State ──
  let stagingDiffFile = $state<string | null>(null);
  let stagingDiffStaged = $state(false);
  let stagingDiffContent = $state('');
  let stagingDiffLoading = $state(false);

  // Original (pre-rename) path for the currently-previewed file, if it is a rename.
  const stagingDiffOrigPath = $derived.by(() => {
    if (!stagingDiffFile) return null;
    const entry = worktreeStatus.find(f => f.path === stagingDiffFile);
    return entry?.origPath ?? null;
  });

  async function loadStagingDiff(path: string, staged: boolean) {
    if (!selectedWorktree) return;
    stagingDiffFile = path;
    stagingDiffStaged = staged;
    stagingDiffLoading = true;
    try {
      const result = await getWorkingDiff(selectedWorktree.path, staged, path);
      stagingDiffContent = result.diff;
    } catch (err) {
      toast.error(`Failed to load diff: ${err}`);
      stagingDiffContent = '';
    } finally {
      stagingDiffLoading = false;
    }
  }

  async function loadWorktreeStatus() {
    if (!selectedWorktree) {
      worktreeStatus = [];
      return;
    }
    statusLoading = true;
    try {
      const result = await getWorktreeStatus(selectedWorktree.path);
      worktreeStatus = result.files;
      worktreeChangeCounts[selectedWorktree.path] = result.files.length;
      // Prune selected keys that no longer exist after an external status change.
      if (selectedFilePaths.size > 0) {
        const validKeys = new Set<string>([
          ...result.files
            .filter(f => f.indexStatus !== ' ' && f.indexStatus !== '?')
            .map(f => `staged:${f.path}`),
          ...result.files.filter(f => f.workTreeStatus !== ' ').map(f => `unstaged:${f.path}`),
        ]);
        selectedFilePaths = new Set([...selectedFilePaths].filter(k => validKeys.has(k)));
      }
    } catch (err) {
      toast.error(`Failed to load status: ${err}`);
    } finally {
      statusLoading = false;
    }
  }

  async function handleStageFiles(paths: string[]) {
    if (!selectedWorktree) return;
    stagingAction = paths[0];
    try {
      const result = await stageFiles(selectedWorktree.path, paths);
      worktreeStatus = result.files;
      // Refresh diff if the staged file is currently shown as unstaged
      if (stagingDiffFile && paths.includes(stagingDiffFile) && !stagingDiffStaged) {
        await loadStagingDiff(stagingDiffFile, true);
      }
    } catch (err) {
      toast.error(String(err));
    } finally {
      stagingAction = null;
    }
  }

  async function handleUnstageFiles(paths: string[]) {
    if (!selectedWorktree) return;
    stagingAction = paths[0];
    try {
      const result = await unstageFiles(selectedWorktree.path, paths);
      worktreeStatus = result.files;
      // Refresh diff if the unstaged file is currently shown as staged
      if (stagingDiffFile && paths.includes(stagingDiffFile) && stagingDiffStaged) {
        await loadStagingDiff(stagingDiffFile, false);
      }
    } catch (err) {
      toast.error(String(err));
    } finally {
      stagingAction = null;
    }
  }

  async function handleCreateCommit() {
    if (!selectedWorktree || !commitMessage.trim()) {
      toast.error('Commit message is required');
      return;
    }
    committing = true;
    try {
      const result = await createCommit(selectedWorktree.path, commitMessage);
      toast.success(`Committed: ${result.subject}`);
      commitMessage = '';
      stagingDiffFile = null;
      stagingDiffContent = '';
      refreshWorkspaceData();
    } catch (err) {
      toast.error(String(err));
    } finally {
      committing = false;
    }
  }

  // ── File interaction handlers for multi-select ──

  function handleFileMouseDown(e: MouseEvent, key: string) {
    // Only initiate drag for plain clicks (not modifier-key selections).
    if (e.shiftKey || e.ctrlKey || e.metaKey) return;
    isDragSelecting = true;
    dragStartKey = key;
    didDragExpand = false;
  }

  function handleFileMouseEnter(key: string) {
    if (!isDragSelecting || !dragStartKey) return;
    const start = allFileKeys.indexOf(dragStartKey);
    const end = allFileKeys.indexOf(key);
    if (start === -1 || end === -1 || start === end) return;
    const [from, to] = start < end ? [start, end] : [end, start];
    selectedFilePaths = new Set(allFileKeys.slice(from, to + 1));
    lastClickedKey = dragStartKey;
    didDragExpand = true;
    // No diff to show while multiple files are being drag-selected.
    stagingDiffFile = null;
    stagingDiffContent = '';
  }

  function handleFileClick(e: MouseEvent, key: string) {
    isDragSelecting = false;
    if (didDragExpand) {
      // Selection was already expanded during drag; just finalize.
      didDragExpand = false;
      return;
    }
    if (e.shiftKey && lastClickedKey) {
      // Range-select from the last clicked file to this one.
      const start = allFileKeys.indexOf(lastClickedKey);
      const end = allFileKeys.indexOf(key);
      const [from, to] = start < end ? [start, end] : [end, start];
      const range = allFileKeys.slice(from, to + 1);
      if (e.ctrlKey || e.metaKey) {
        // Ctrl/Cmd+Shift: append range to the existing selection.
        selectedFilePaths = new Set([...selectedFilePaths, ...range]);
      } else {
        // Plain Shift: replace selection with range.
        selectedFilePaths = new Set(range);
      }
      // Keep lastClickedKey as the range anchor for chained shift+clicks.
    } else if (e.ctrlKey || e.metaKey) {
      // Toggle this file's presence in the selection.
      const next = new Set(selectedFilePaths);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      selectedFilePaths = next;
      lastClickedKey = key;
    } else {
      // Plain click: select only this file.
      selectedFilePaths = new Set([key]);
      lastClickedKey = key;
    }
    // Show diff for a single selection; clear it for zero or multiple.
    if (selectedFilePaths.size === 1) {
      const onlyKey = [...selectedFilePaths][0];
      const isStaged = onlyKey.startsWith('staged:');
      const onlyPath = onlyKey.slice(isStaged ? 7 : 9); // "staged:".length=7, "unstaged:".length=9
      void loadStagingDiff(onlyPath, isStaged);
    } else {
      stagingDiffFile = null;
      stagingDiffContent = '';
    }
  }

  // End drag selection on any mouseup (even outside the list).
  $effect(() => {
    function endDrag() {
      isDragSelecting = false;
      dragStartKey = null;
    }
    window.addEventListener('mouseup', endDrag);
    return () => window.removeEventListener('mouseup', endDrag);
  });

  $effect(() => {
    if (selectedWorktree) {
      // Reset file selection whenever the active worktree changes.
      selectedFilePaths = new Set();
      lastClickedKey = null;
      loadWorktreeStatus();
    }
  });

  // ── File Watcher ──

  let unlistenWorktreeChanged: (() => void) | null = null;

  async function handleWorktreeChanged(changedPathRaw: string) {
    // The Rust watcher emits OS-native paths (backslashes on Windows) while
    // listWorktrees returns forward-slash paths. Normalise separators only —
    // never lowercase, since Linux filesystems are case-sensitive.
    const changedPath = normalizePathSeparators(changedPathRaw);
    // Update the change count and file list for the specific worktree that changed.
    // Never resets activeWorktreePath or activeTab, and never touches the graph
    // (to avoid a visible full re-render while the user is on the Changes tab).
    try {
      const result = await getWorktreeStatus(changedPath);
      worktreeChangeCounts[changedPath] = result.files.length;
      if (pathsEqual(changedPath, selectedWorktree?.path)) {
        worktreeStatus = result.files;
        // Refresh active diff to reflect the new working tree / index state.
        if (stagingDiffFile && activeTab === 'changes') {
          void loadStagingDiff(stagingDiffFile, stagingDiffStaged);
        }
      }
    } catch {
      // Ignore — worktree may have been deleted.
    }
  }

  async function setupWatcher() {
    if (!workspace) return;
    const allPaths = worktrees.map(wt => wt.path);
    try {
      await startWatchingWorktrees(allPaths, workspace.rootPath);
      if (unlistenWorktreeChanged) unlistenWorktreeChanged();
      unlistenWorktreeChanged = await onWorktreeChanged(handleWorktreeChanged);
    } catch (e) {
      console.warn('Failed to start file watcher:', e);
    }
  }

  onDestroy(() => {
    unlistenWorktreeChanged?.();
    void stopWatchingWorktrees();
  });

  // ── Session state persistence (survives HMR reloads in dev mode) ──

  $effect(() => {
    if (activeWorktreePath) sessionStorage.setItem('sg_active_wt', activeWorktreePath);
  });
  $effect(() => {
    sessionStorage.setItem('sg_active_tab', activeTab);
  });

  async function loadWorkspace() {
    loading = true;
    error = '';

    try {
      const workspacePath = $page.url.searchParams.get('workspace')?.trim();
      if (!workspacePath) {
        throw new Error('Missing workspace path. Open a project from the home screen.');
      }

      const hintedStatus = readWorkspaceHint(workspacePath);
      const status = await inspectWorkspaceWithRetry(workspacePath).catch(err => {
        if (hintedStatus) {
          return hintedStatus;
        }
        throw err;
      });
      if (!status.isSproutgitProject) {
        throw new Error('Path is not a SproutGit project.');
      }

      // Preserve original-case paths from the backend. Filesystems on Linux are
      // case-sensitive, so lowercasing breaks any subsequent path operation
      // (e.g. running `git -C <path>`). Path comparisons that need to tolerate
      // case-only differences on Windows do their own case folding at the
      // comparison site.
      workspace = status;

      const [worktreeData, refsData, graphData] = await Promise.all([
        readWithRetry(() => listWorktrees(status.rootPath), isWorktreeListResult, 'Worktree list'),
        readWithRetry(() => listRefs(status.rootPath), isRefsResult, 'Ref list'),
        readWithRetry(
          () => getCommitGraph(status.rootPath, GRAPH_PAGE_SIZE, 0),
          isCommitGraphResult,
          'Commit graph'
        ),
      ]);

      worktrees = worktreeData.worktrees;
      refs = refsData.refs;
      initializeGraphState(graphData);
      selectedRef = refsData.refs[0]?.name ?? 'HEAD';

      if (graphHasMore) {
        // Fetch total commit count in the background only when the first page is partial.
        totalCommitCount = null;
        countCommits(status.rootPath)
          .then(n => {
            totalCommitCount = n;
          })
          .catch(() => {});
      } else {
        totalCommitCount = graphData.commits.length;
      }

      // Restore the previously active worktree if still valid (survives HMR).
      // Resolve the persisted path against the live worktree list using
      // filesystem-aware equality so the result is the actual on-disk path
      // (preserves case on Linux).
      const savedWtRaw = sessionStorage.getItem('sg_active_wt') ?? '';
      const matchedSavedWt = savedWtRaw
        ? findPath(worktreeData.worktrees, wt => wt.path, savedWtRaw)
        : null;
      activeWorktreePath = matchedSavedWt?.path ?? worktreeData.worktrees[0]?.path ?? null;
      // (activeTab is already initialised from sessionStorage at declaration time.)

      // Load available shells and the user's default shell preference
      const [shells, savedShell] = await Promise.all([
        listAvailableShells().catch(() => [] as string[]),
        getAppSetting('default_shell').catch(() => null),
      ]);
      availableShells = shells;
      defaultShell = savedShell ?? shells[0] ?? '';

      // Load change counts for all non-root worktrees
      const nonRoot = worktreeData.worktrees
        .filter(wt => !pathsEqual(wt.path, status.rootPath))
        .map(wt => wt.path);
      void loadAllWorktreeChangeCounts(nonRoot);
      void setupWatcher();
    } catch (err) {
      error = String(err);
    } finally {
      loading = false;
    }
  }

  async function createFirstWorktree(event: Event) {
    event.preventDefault();
    if (!workspace) return;

    formTouched = { branch: true, ref: true };
    if (!formValid) return;

    creating = true;
    error = '';

    try {
      await beginOperation(
        'Creating worktree',
        'Running hooks and creating the managed worktree...',
        ['before_worktree_create', 'after_worktree_create']
      );

      const currentWorkspace = workspace;
      if (!currentWorkspace) {
        throw new Error('Workspace context is unavailable');
      }

      const requestedBranch = newBranch;

      const result = await createManagedWorktree(
        currentWorkspace.rootPath,
        currentWorkspace.worktreesPath,
        selectedRef,
        requestedBranch,
        activeWorktreePath
      );

      const createdBranch =
        result && typeof result.branch === 'string' && result.branch.trim()
          ? result.branch
          : requestedBranch;
      const createdWorktreePath =
        result && typeof result.worktreePath === 'string' && result.worktreePath.trim()
          ? result.worktreePath
          : `${currentWorkspace.worktreesPath}/${slugifyForPath(createdBranch)}`;

      toast.success(`Worktree created: ${createdBranch}`);

      const normalizedCreatedPath = normalizePathSeparators(createdWorktreePath);
      try {
        await refreshWorkspaceData();
        // Switch to the newly created worktree, falling back to first non-root.
        activeWorktreePath =
          findPath(worktrees, wt => wt.path, normalizedCreatedPath)?.path ??
          worktrees.find(wt => !pathsEqual(wt.path, currentWorkspace.rootPath))?.path ??
          worktrees[0]?.path ??
          null;
      } catch {
        const fallbackWorktree: WorktreeInfo = {
          path: normalizedCreatedPath,
          branch: createdBranch,
          head: null,
          detached: false,
        };
        worktrees = [
          ...worktrees.filter(wt => wt.path !== fallbackWorktree.path),
          fallbackWorktree,
        ];
        activeWorktreePath = fallbackWorktree.path;
      }

      newBranch = '';
      formTouched = { branch: false, ref: false };
    } catch (err) {
      failOperation(String(err));
      toast.error(String(err));
      error = String(err);
    } finally {
      endOperation();
      creating = false;
    }
  }

  loadWorkspace();

  const unlistenHookProgress = onHookProgress(handleHookProgress);
  const unlistenHookTerminalLaunch = onHookTerminalLaunch(handleHookTerminalLaunch);
  onDestroy(() => {
    void unlistenHookProgress.then(unlisten => unlisten());
    void unlistenHookTerminalLaunch.then(unlisten => unlisten());
  });

  function handleHookTerminalLaunch(event: HookTerminalLaunchEvent) {
    // Preserve case so the path remains valid on case-sensitive filesystems
    // (Linux). Compare against existing worktree paths case-insensitively
    // through `pathsEqual()` / `pathKey()` to tolerate Windows differences.
    const cwd = normalizePathSeparators(event.cwd);
    // Set the active worktree FIRST so the lazy-init $effect (which may fire between
    // individual assignments in an async callback context) always sees the correct
    // worktree path and does not add the previously-active worktree to terminalInitializedPaths.
    activeWorktreePath = cwd;
    activeTab = 'terminal';
    // Ensure the TerminalContainer for this worktree is in the DOM.
    if (!terminalInitializedPaths.has(cwd)) {
      terminalInitializedPaths = new Set([...terminalInitializedPaths, cwd]);
    }
    // Set the launch request for the TerminalContainer to pick up the command
    hookTerminalLaunchRequest = {
      id: `${event.hookId}-${Date.now()}`,
      cwd,
      shell: event.shell,
      label: event.hookName,
      command: event.command,
    };
    appendOperationLog(
      `Opened ${event.hookName} in the ${cwd.split('/').pop() ?? 'worktree'} terminal.`
    );
  }

  function handleCreateWorktreeFromGraph(fromRef: string) {
    selectedRef = fromRef;
    newBranch = '';
    // Focus the new branch input after state update
    requestAnimationFrame(() => {
      document.getElementById('new-branch')?.focus();
    });
  }

  async function handleRevealWorktree(path: string) {
    try {
      await openPath(path);
    } catch (err) {
      toast.error(String(err));
    }
  }

  async function handleOpenInEditor(path: string) {
    try {
      const editor = await openInEditor(path);
      toast.success(`Opened in ${editor}`);
    } catch (err) {
      toast.error(String(err));
    }
  }

  function formatHookTrigger(trigger: WorkspaceHookTrigger): string {
    return trigger === 'manual' ? 'manual' : trigger.replaceAll('_', ' ');
  }

  async function openRunHookMenu(wt: WorktreeInfo, anchor: HTMLElement) {
    if (!workspace) return;

    try {
      const availableHooks = (await listWorkspaceHooks(workspace.workspacePath)).filter(
        hook => hook.enabled
      );

      if (availableHooks.length === 0) {
        toast.info('No enabled hooks are available to run');
        return;
      }

      const manualHooks = sortHooksByTriggerAndName(
        availableHooks.filter(hook => hook.trigger === 'manual')
      );
      const lifecycleHooks = sortHooksByTriggerAndName(
        availableHooks.filter(hook => hook.trigger !== 'manual')
      );
      const items: MenuItem[] = [];

      for (const hook of manualHooks) {
        items.push({
          label: hook.name,
          icon: '▶',
          action: () => void handleRunHook(wt, hook, availableHooks),
        });
      }

      if (manualHooks.length > 0 && lifecycleHooks.length > 0) {
        items.push({ separator: true });
      }

      for (const hook of lifecycleHooks) {
        items.push({
          label: `${hook.name} (${formatHookTrigger(hook.trigger)})`,
          icon: '▶',
          action: () => void handleRunHook(wt, hook, availableHooks),
        });
      }

      const rect = anchor.getBoundingClientRect();
      worktreeContextMenu = {
        x: Math.round(rect.right),
        y: Math.round(rect.bottom + 6),
        items,
      };
    } catch (err) {
      toast.error(`Failed to load hooks: ${err}`);
    }
  }

  async function handleRunHook(
    wt: WorktreeInfo,
    hook: WorkspaceHook,
    availableHooks: WorkspaceHook[]
  ) {
    if (!workspace) return;

    worktreeContextMenu = null;
    const closureHooks = collectHookClosure(availableHooks, hook.id);
    const label = wt.branch ?? wt.path.split('/').pop() ?? 'worktree';

    try {
      await beginOperation(
        'Running hook',
        `Executing ${hook.name} for ${label}...`,
        [],
        closureHooks
      );
      await runWorkspaceHook(
        workspace.workspacePath,
        hook.id,
        wt.path,
        activeWorktreePath ?? wt.path
      );
      toast.success(`Ran hook: ${hook.name}`);
    } catch (err) {
      failOperation(String(err));
      toast.error(String(err));
    } finally {
      endOperation();
    }
  }

  async function handleDeleteWorktree(wt: WorktreeInfo) {
    if (!workspace) return;
    const label = wt.branch ?? wt.path.split('/').pop() ?? 'worktree';
    confirmDialog = {
      title: 'Delete worktree',
      message: `Delete worktree "${label}"? This will remove the directory and prune the worktree.`,
      confirmLabel: 'Delete',
      danger: true,
      onconfirm: async () => {
        confirmDialog = null;
        deleting = wt.path;
        try {
          await beginOperation(
            'Removing worktree',
            'Running hooks and removing worktree files...',
            ['before_worktree_remove', 'after_worktree_remove']
          );
          await deleteManagedWorktree(workspace!.rootPath, wt.path, true, activeWorktreePath);
          toast.success(`Deleted worktree: ${label}`);
          try {
            await refreshWorkspaceData();
          } catch {
            worktrees = worktrees.filter(worktree => worktree.path !== wt.path);
          }
          if (activeWorktreePath === wt.path) {
            activeWorktreePath =
              worktrees.find(w => !pathsEqual(w.path, workspace!.rootPath))?.path ??
              worktrees[0]?.path ??
              null;
          }
        } catch (err) {
          failOperation(String(err));
          toast.error(String(err));
        } finally {
          endOperation();
          deleting = null;
        }
      },
    };
  }

  async function refreshWorkspaceData() {
    if (!workspace) return;
    const workspaceRootPath = workspace.rootPath;
    const [refreshedWt, refreshedGraph, refreshedRefs] = await Promise.all([
      readWithRetry(() => listWorktrees(workspaceRootPath), isWorktreeListResult, 'Worktree list'),
      readWithRetry(
        () => getCommitGraph(workspaceRootPath, GRAPH_PAGE_SIZE, 0),
        isCommitGraphResult,
        'Commit graph'
      ),
      readWithRetry(() => listRefs(workspaceRootPath), isRefsResult, 'Ref list'),
    ]);
    worktrees = refreshedWt.worktrees;
    initializeGraphState(refreshedGraph);
    refs = refreshedRefs.refs;
    if (graphHasMore) {
      // Refresh total commit count in the background only when the graph is partial.
      totalCommitCount = null;
      countCommits(workspaceRootPath)
        .then(n => {
          totalCommitCount = n;
        })
        .catch(() => {});
    } else {
      totalCommitCount = refreshedGraph.commits.length;
    }
    // Refresh change counts for all non-root worktrees
    const nonRoot = refreshedWt.worktrees
      .filter(wt => !pathsEqual(wt.path, workspaceRootPath))
      .map(wt => wt.path);
    void loadAllWorktreeChangeCounts(nonRoot);
    // Restart watcher so any newly created/deleted worktrees are included.
    void setupWatcher();
  }

  async function loadMoreGraphCommits() {
    if (!workspace || graphLoadingMore || !graphHasMore) return;

    const requestGeneration = graphGeneration;
    graphLoadingMore = true;
    try {
      const nextPage = await getCommitGraph(workspace.rootPath, GRAPH_PAGE_SIZE, graphSkip);
      if (requestGeneration !== graphGeneration) {
        return;
      }
      if (!graph) {
        initializeGraphState(nextPage);
      } else {
        const newCommits = nextPage.commits.filter(commit => !graphSeenHashes.has(commit.hash));
        for (const commit of newCommits) {
          graphSeenHashes.add(commit.hash);
        }
        graph = {
          ...graph,
          commits: [...graph.commits, ...newCommits],
        };
        graphSkip += nextPage.commits.length;
        graphHasMore = nextPage.commits.length === GRAPH_PAGE_SIZE;
      }
    } catch (err) {
      toast.error(`Failed to load more commits: ${err}`);
    } finally {
      graphLoadingMore = false;
    }
  }

  async function handleCheckoutWorktree(wt: WorktreeInfo, targetRef: string) {
    if (!workspace) return;
    const label = wt.branch ?? 'worktree';
    confirmDialog = {
      title: 'Checkout branch',
      message: `Switch worktree "${label}" to ${targetRef}? Uncommitted changes will be auto-stashed.`,
      confirmLabel: 'Checkout',
      danger: false,
      onconfirm: async () => {
        confirmDialog = null;
        try {
          await beginOperation('Switching worktree', 'Running hooks and switching branch...', [
            'before_worktree_switch',
            'after_worktree_switch',
          ]);
          const result = await checkoutWorktree(wt.path, targetRef, true);
          if (result.stashed) {
            toast.warning(
              `Checked out ${result.newBranch} — changes were stashed (may need manual resolve)`
            );
          } else {
            toast.success(`Checked out ${result.newBranch}`);
          }
          await refreshWorkspaceData();
        } catch (err) {
          failOperation(String(err));
          toast.error(String(err));
        } finally {
          endOperation();
        }
      },
    };
  }

  async function handleResetWorktree(
    wt: WorktreeInfo,
    targetRef: string,
    mode: 'soft' | 'mixed' | 'hard'
  ) {
    if (!workspace) return;
    const label = wt.branch ?? 'worktree';
    const modeDesc =
      mode === 'hard'
        ? 'This will discard all uncommitted changes.'
        : mode === 'mixed'
          ? 'This will unstage changes but keep working directory modifications.'
          : 'This will only move the branch pointer.';
    confirmDialog = {
      title: `Reset branch (${mode})`,
      message: `Reset "${label}" to ${targetRef}? ${modeDesc}`,
      confirmLabel: `Reset ${mode}`,
      danger: mode === 'hard',
      onconfirm: async () => {
        confirmDialog = null;
        try {
          await beginOperation('Resetting branch', `Applying ${mode} reset to ${targetRef}...`);
          await resetWorktreeBranch(wt.path, targetRef, mode);
          toast.success(`Reset ${label} to ${targetRef} (${mode})`);
          await refreshWorkspaceData();
        } catch (err) {
          failOperation(String(err));
          toast.error(String(err));
        } finally {
          endOperation();
        }
      },
    };
  }

  // ── Graph-driven checkout/reset (from context menu) ──
  function handleGraphCheckout(targetRef: string) {
    if (!selectedWorktree || activeIsRoot) return;
    handleCheckoutWorktree(selectedWorktree, targetRef);
  }

  function handleGraphReset(targetRef: string, mode: 'soft' | 'mixed' | 'hard') {
    if (!selectedWorktree || activeIsRoot) return;
    handleResetWorktree(selectedWorktree, targetRef, mode);
  }

  // ── Commit selection → diff loading ──
  async function handleCommitSelect(commits: CommitEntry[]) {
    selectedCommits = commits;
    diffFiles = [];
    diffContent = '';
    diffSelectedFile = null;

    if (commits.length === 0 || !workspace) return;

    diffLoading = true;
    try {
      if (commits.length === 1) {
        // Single commit: show files changed in that commit
        const result = await getDiffFiles(workspace.rootPath, commits[0].hash);
        diffFiles = result.files;
      } else {
        // Multiple commits: diff from oldest to newest
        const sorted = [...commits].sort((a, b) => {
          // Use graph order (index in commits array)
          const aIdx = graph?.commits.findIndex(c => c.hash === a.hash) ?? 0;
          const bIdx = graph?.commits.findIndex(c => c.hash === b.hash) ?? 0;
          return bIdx - aIdx; // Higher index = older in graph
        });
        const oldest = sorted[0];
        const newest = sorted[sorted.length - 1];
        const result = await getDiffFiles(workspace.rootPath, newest.hash, oldest.hash);
        diffFiles = result.files;
      }
    } catch (err) {
      toast.error(`Failed to load files: ${err}`);
    } finally {
      diffLoading = false;
    }
  }

  async function handleDiffFileSelect(filePath: string) {
    if (!workspace || selectedCommits.length === 0) return;
    diffSelectedFile = filePath;
    diffLoading = true;
    try {
      if (selectedCommits.length === 1) {
        const result = await getDiffContent(
          workspace.rootPath,
          selectedCommits[0].hash,
          null,
          filePath
        );
        diffContent = result.diff;
      } else {
        const sorted = [...selectedCommits].sort((a, b) => {
          const aIdx = graph?.commits.findIndex(c => c.hash === a.hash) ?? 0;
          const bIdx = graph?.commits.findIndex(c => c.hash === b.hash) ?? 0;
          return bIdx - aIdx;
        });
        const oldest = sorted[0];
        const newest = sorted[sorted.length - 1];
        const result = await getDiffContent(workspace.rootPath, newest.hash, oldest.hash, filePath);
        diffContent = result.diff;
      }
    } catch (err) {
      toast.error(`Failed to load diff: ${err}`);
      diffContent = '';
    } finally {
      diffLoading = false;
    }
  }

  function closeDiffViewer() {
    selectedCommits = [];
    diffFiles = [];
    diffContent = '';
    diffSelectedFile = null;
  }

  const diffCommitLabel = $derived.by(() => {
    if (selectedCommits.length === 0) return '';
    if (selectedCommits.length === 1) return selectedCommits[0].shortHash;
    return `${selectedCommits.length} commits`;
  });

  // ── Worktree list context menu ──
  function handleWorktreeContextMenu(wt: WorktreeInfo, e: MouseEvent) {
    e.preventDefault();
    const label = wt.branch ?? wt.path.split('/').pop() ?? 'worktree';
    const items: MenuItem[] = [
      { label: 'Open folder', icon: '📂', action: () => handleRevealWorktree(wt.path) },
      { separator: true },
    ];
    if (wt.branch && !wt.detached) {
      items.push({
        label: 'Checkout…',
        icon: '⎋',
        action: () => {
          activeWorktreePath = wt.path;
          actionRef = '';
          // Focus the action ref input
          requestAnimationFrame(() => document.getElementById('action-ref')?.focus());
        },
      });
    }
    items.push({ separator: true });
    items.push({
      label: `Delete "${label}"`,
      danger: true,
      action: () => handleDeleteWorktree(wt),
    });
    worktreeContextMenu = { x: e.clientX, y: e.clientY, items };
  }
</script>

{#snippet fileStatusIcon(status: string)}
  {#if status === 'A' || status === '?'}
    <!-- Added / Untracked: green + -->
    <svg class="h-3 w-3 shrink-0 text-green-400" viewBox="0 0 16 16" fill="currentColor">
      <path
        d="M8 2a.75.75 0 0 1 .75.75v4.5h4.5a.75.75 0 0 1 0 1.5h-4.5v4.5a.75.75 0 0 1-1.5 0v-4.5h-4.5a.75.75 0 0 1 0-1.5h4.5v-4.5A.75.75 0 0 1 8 2Z"
      />
    </svg>
  {:else if status === 'D'}
    <!-- Deleted: red − -->
    <svg class="h-3 w-3 shrink-0 text-red-400" viewBox="0 0 16 16" fill="currentColor">
      <path d="M2 8.75a.75.75 0 0 1 .75-.75h10.5a.75.75 0 0 1 0 1.5H2.75A.75.75 0 0 1 2 8.75Z" />
    </svg>
  {:else if status === 'R'}
    <!-- Renamed: accent → -->
    <svg class="h-3 w-3 shrink-0 text-[var(--sg-accent)]" viewBox="0 0 16 16" fill="currentColor">
      <path
        d="M9.78 4.22a.75.75 0 0 1 1.06 0l3 3a.75.75 0 0 1 0 1.06l-3 3a.75.75 0 0 1-1.06-1.06l1.72-1.72H2.75a.75.75 0 0 1 0-1.5h8.75L9.78 5.28a.75.75 0 0 1 0-1.06Z"
      />
    </svg>
  {:else if status === 'U'}
    <!-- Conflict: red ! -->
    <svg class="h-3 w-3 shrink-0 text-red-400" viewBox="0 0 16 16" fill="currentColor">
      <path
        d="M8 1a7 7 0 1 1 0 14A7 7 0 0 1 8 1Zm0 3.5a.75.75 0 0 0-.75.75v3.5a.75.75 0 0 0 1.5 0v-3.5A.75.75 0 0 0 8 4.5Zm0 6.5a1 1 0 1 0 0-2 1 1 0 0 0 0 2Z"
      />
    </svg>
  {:else}
    <!-- Modified (M, C, or other): amber dot -->
    <svg class="h-3 w-3 shrink-0 text-amber-400" viewBox="0 0 16 16" fill="currentColor">
      <path
        d="M11.013 1.427a1.75 1.75 0 0 1 2.474 0l1.086 1.086a1.75 1.75 0 0 1 0 2.474l-8.61 8.61c-.21.21-.47.364-.756.445l-3.251.93a.75.75 0 0 1-.927-.928l.929-3.25c.081-.286.235-.547.445-.756l8.61-8.61Z"
      />
    </svg>
  {/if}
{/snippet}

<main class="flex h-screen flex-col">
  <!-- Context header -->
  <header
    data-tauri-drag-region
    class="flex h-(--sg-titlebar-height) shrink-0 items-center gap-3 border-b border-[var(--sg-border)] bg-[var(--sg-surface)] pr-1 pl-[var(--sg-titlebar-inset)]"
    style="view-transition-name: sg-app-header"
  >
    <button
      onclick={() => goto('/')}
      data-testid="btn-back-projects"
      class="rounded px-2 py-0.5 text-xs text-[var(--sg-text-dim)] hover:bg-[var(--sg-surface-raised)] hover:text-[var(--sg-text)]"
    >
      &larr; Projects
    </button>
    <div class="h-3 w-px bg-[var(--sg-border)]"></div>
    <span class="text-xs text-[var(--sg-text)]"
      >{workspace?.workspacePath.split('/').pop() ?? '...'}</span
    >
    <span class="text-xs text-[var(--sg-text-faint)]">&rsaquo;</span>
    <span class="text-xs text-[var(--sg-primary)]">
      {selectedWorktree?.branch ?? (selectedWorktree?.detached ? 'detached' : '—')}
    </span>
    <div class="ml-auto flex h-full items-center">
      <button
        onclick={() =>
          goto(
            workspace?.workspacePath
              ? `/settings?workspace=${encodeURIComponent(workspace.workspacePath)}`
              : '/settings'
          )}
        class="rounded-full p-1 text-[var(--sg-text-faint)] hover:bg-[var(--sg-surface-raised)] hover:text-[var(--sg-text)]"
        title="Settings"
        data-testid="btn-open-settings"
      >
        <svg
          xmlns="http://www.w3.org/2000/svg"
          width="16"
          height="16"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          stroke-width="2"
          stroke-linecap="round"
          stroke-linejoin="round"
          ><circle cx="12" cy="12" r="3" /><path
            d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"
          /></svg
        >
      </button>
      <UpdateBadge
        href={workspace?.workspacePath
          ? `/settings?workspace=${encodeURIComponent(workspace.workspacePath)}`
          : '/settings'}
      />
      <WindowControls />
    </div>
  </header>

  {#if loading}
    <div
      class="flex flex-1 flex-col items-center justify-center gap-3"
      style="animation: sg-fade-in 0.3s ease-out"
    >
      <Spinner size="lg" />
      <p class="text-sm text-[var(--sg-text-faint)]">Loading workspace…</p>
    </div>
  {:else}
    {#if error}
      <div
        class="border-b border-[var(--sg-border)] bg-[var(--sg-surface-raised)] px-4 py-2 text-xs text-[var(--sg-danger)]"
        style="animation: sg-slide-down 0.2s ease-out"
      >
        {error}
      </div>
    {/if}

    <div
      class="flex min-h-0 flex-1"
      style="view-transition-name: sg-page-content; animation: sg-fade-in 0.3s ease-out"
    >
      <!-- Left sidebar -->
      <aside
        class="flex w-[260px] shrink-0 flex-col border-r border-[var(--sg-border)] bg-[var(--sg-surface)]"
      >
        <!-- Root info -->
        <div class="border-b border-[var(--sg-border-subtle)] px-3 py-2">
          <div class="flex items-center gap-1.5">
            <p
              class="text-[10px] font-semibold uppercase tracking-wider text-[var(--sg-text-faint)]"
            >
              Root
            </p>
            {#if rootWorktree}
              <span
                class="inline-flex items-center gap-0.5 rounded-full bg-[var(--sg-warning)]/15 px-1.5 py-px text-[9px] font-medium text-[var(--sg-warning)] cursor-help"
                title="The root checkout is managed by SproutGit. Do not make changes or work directly in it — use worktrees instead."
              >
                <ShieldAlert class="h-2.5 w-2.5" />
                Protected
              </span>
            {/if}
          </div>
          <p class="mt-0.5 truncate text-xs text-[var(--sg-text-dim)]">
            {workspace ? tildify(workspace.rootPath) : '—'}
          </p>
        </div>

        <!-- Create worktree form -->
        <form
          onsubmit={createFirstWorktree}
          class="border-b border-[var(--sg-border-subtle)] px-3 py-3"
        >
          <p
            class="mb-2 text-[10px] font-semibold uppercase tracking-wider text-[var(--sg-text-faint)]"
          >
            New worktree
          </p>

          <label for="source-ref" class="mb-0.5 block text-[10px] text-[var(--sg-text-faint)]"
            >Source ref</label
          >
          <div>
            <Autocomplete
              items={refItems}
              bind:value={selectedRef}
              testId="input-source-ref"
              placeholder="Type to search branches…"
              id="source-ref"
              onselect={() => (formTouched.ref = true)}
            />
          </div>
          {#if formTouched.ref && refError}
            <p class="mt-0.5 text-[10px] text-[var(--sg-danger)]">{refError}</p>
          {/if}
          <div class="mb-2"></div>

          <label for="new-branch" class="mb-0.5 block text-[10px] text-[var(--sg-text-faint)]"
            >New branch</label
          >
          <input
            id="new-branch"
            bind:value={newBranch}
            oninput={() => (formTouched.branch = true)}
            data-testid="input-new-branch"
            class="w-full rounded border bg-[var(--sg-input-bg)] px-2 py-1 text-xs text-[var(--sg-text)] placeholder-[var(--sg-text-faint)] outline-none {formTouched.branch &&
            branchError
              ? 'border-[var(--sg-danger)] focus:border-[var(--sg-danger)]'
              : 'border-[var(--sg-input-border)] focus:border-[var(--sg-input-focus)]'}"
            placeholder="feature/my-task"
          />
          {#if formTouched.branch && branchError}
            <p class="mt-0.5 text-[10px] text-[var(--sg-danger)]">{branchError}</p>
          {/if}
          <div class="mb-2"></div>

          <button
            type="submit"
            disabled={creating || !formValid}
            data-testid="btn-create-worktree"
            class="flex w-full items-center justify-center gap-2 rounded bg-[var(--sg-primary)] px-2.5 py-1 text-xs font-semibold text-[var(--sg-bg)] hover:bg-[var(--sg-primary-hover)] disabled:cursor-not-allowed disabled:opacity-40"
          >
            {#if creating}
              <Spinner size="sm" />
              Creating…
            {:else}
              Create worktree
            {/if}
          </button>
        </form>

        <!-- Worktree list -->
        <div class="flex min-h-0 flex-1 flex-col">
          <div class="flex items-center justify-between px-3 py-2">
            <p
              class="text-[10px] font-semibold uppercase tracking-wider text-[var(--sg-text-faint)]"
            >
              Worktrees
            </p>
            <button
              onclick={() => {
                hooksModalOpen = true;
              }}
              class="rounded p-1 text-[var(--sg-text-faint)] hover:bg-[var(--sg-surface-raised)] hover:text-[var(--sg-text)]"
              title="Manage workspace hooks"
              aria-label="Manage workspace hooks"
            >
              <Settings class="h-3.5 w-3.5" />
            </button>
          </div>
          <div class="flex-1 overflow-auto px-2" data-testid="worktree-list">
            {#if nonRootWorktrees.length === 0}
              <p class="px-1 text-xs text-[var(--sg-text-faint)]">No managed worktrees yet.</p>
            {:else}
              {#each nonRootWorktrees as wt}
                <!-- svelte-ignore a11y_no_static_element_interactions -->
                <!-- svelte-ignore a11y_click_events_have_key_events -->
                <div
                  class="group mb-0.5 flex w-full cursor-pointer items-center gap-2 rounded px-2 py-1.5 text-left text-xs {activeWorktreePath ===
                  wt.path
                    ? 'bg-[var(--sg-surface-raised)] text-[var(--sg-primary)]'
                    : 'text-[var(--sg-text-dim)] hover:bg-[var(--sg-surface-raised)]'}"
                  data-testid="worktree-item"
                  data-branch={wt.branch}
                  data-path={wt.path}
                  data-active={activeWorktreePath === wt.path ? 'true' : 'false'}
                  onclick={() => {
                    activeWorktreePath = activeWorktreePath === wt.path ? null : wt.path;
                  }}
                  oncontextmenu={e => handleWorktreeContextMenu(wt, e)}
                >
                  <span
                    class="h-1.5 w-1.5 shrink-0 rounded-full {activeWorktreePath === wt.path
                      ? 'bg-[var(--sg-primary)]'
                      : 'bg-[var(--sg-border)]'}"
                  ></span>
                  <span class="min-w-0 flex-1 truncate"
                    >{wt.branch ?? (wt.detached ? 'detached' : 'unknown')}</span
                  >
                  {#if (worktreeChangeCounts[wt.path] ?? 0) > 0}
                    <span
                      class="shrink-0 rounded-full bg-[var(--sg-warning)]/20 px-1.5 py-0.5 font-mono text-[9px] font-bold text-[var(--sg-warning)] group-hover:hidden"
                    >
                      {worktreeChangeCounts[wt.path]}
                    </span>
                  {/if}
                  <!-- svelte-ignore a11y_no_static_element_interactions -->
                  <!-- svelte-ignore a11y_click_events_have_key_events -->
                  <div
                    class="hidden shrink-0 items-center gap-0.5 group-hover:flex"
                    role="none"
                    onclick={e => e.stopPropagation()}
                  >
                    <button
                      onclick={event => openRunHookMenu(wt, event.currentTarget as HTMLElement)}
                      class="rounded p-0.5 text-[var(--sg-text-faint)] hover:bg-[var(--sg-surface)] hover:text-[var(--sg-text)]"
                      title="Run hook"
                    >
                      <Play class="h-3 w-3" />
                    </button>
                    <button
                      onclick={() => handleOpenInEditor(wt.path)}
                      class="rounded p-0.5 text-[var(--sg-text-faint)] hover:bg-[var(--sg-surface)] hover:text-[var(--sg-text)]"
                      title="Open in editor"
                    >
                      <SquareTerminal class="h-3 w-3" />
                    </button>
                    <button
                      onclick={() => handleRevealWorktree(wt.path)}
                      class="rounded p-0.5 text-[var(--sg-text-faint)] hover:bg-[var(--sg-surface)] hover:text-[var(--sg-text)]"
                      title="Open folder"
                    >
                      <FolderOpen class="h-3 w-3" />
                    </button>
                    <button
                      onclick={() => handleDeleteWorktree(wt)}
                      disabled={deleting === wt.path}
                      data-testid="btn-delete-worktree"
                      class="rounded p-0.5 text-[var(--sg-text-faint)] hover:bg-[var(--sg-surface)] hover:text-[var(--sg-danger)] disabled:opacity-40"
                      title="Delete worktree"
                    >
                      {#if deleting === wt.path}
                        <Spinner size="sm" />
                      {:else}
                        <Trash2 class="h-3 w-3" />
                      {/if}
                    </button>
                  </div>
                </div>
              {/each}
            {/if}
          </div>
        </div>

        <!-- Active worktree actions (simplified: one ref field) -->
        {#if selectedWorktree && !activeIsRoot}
          <div
            class="border-t border-[var(--sg-border-subtle)] px-3 py-2"
            style="animation: sg-fade-in 0.15s ease-out"
          >
            <p
              class="mb-1 text-[10px] font-semibold uppercase tracking-wider text-[var(--sg-text-faint)]"
            >
              Worktree actions
            </p>
            <div
              class="mb-1.5 rounded border border-[var(--sg-border-subtle)] bg-[var(--sg-surface)] px-2 py-1"
            >
              <span class="text-[9px] text-[var(--sg-text-faint)]">Branch</span>
              <p class="truncate font-mono text-[11px] font-medium text-[var(--sg-text)]">
                {selectedWorktree.branch ?? 'detached HEAD'}
              </p>
              {#if selectedWorktree.head}
                <span class="font-mono text-[9px] text-[var(--sg-text-faint)]"
                  >{selectedWorktree.head.slice(0, 8)}</span
                >
              {/if}
            </div>
            <label for="action-ref" class="mb-0.5 block text-[10px] text-[var(--sg-text-faint)]"
              >Target ref</label
            >
            <div class="mb-1.5">
              <Autocomplete
                items={refItems}
                bind:value={actionRef}
                placeholder="Branch, tag, or commit…"
                id="action-ref"
              />
            </div>
            <div class="flex gap-1">
              <button
                onclick={() => {
                  if (selectedWorktree && actionRef)
                    handleCheckoutWorktree(selectedWorktree, actionRef);
                }}
                disabled={!actionRef}
                class="flex-1 rounded bg-[var(--sg-primary)] px-2 py-1 text-[10px] font-semibold text-[var(--sg-bg)] hover:bg-[var(--sg-primary-hover)] disabled:cursor-not-allowed disabled:opacity-40"
                title="Checkout: switch this worktree to the target ref (auto-stashes uncommitted changes)"
              >
                Checkout
              </button>
              <button
                onclick={() => {
                  if (selectedWorktree && actionRef)
                    handleResetWorktree(selectedWorktree, actionRef, 'mixed');
                }}
                disabled={!actionRef}
                class="rounded border border-[var(--sg-border)] px-2 py-1 text-[10px] text-[var(--sg-text-dim)] hover:bg-[var(--sg-surface-raised)] hover:text-[var(--sg-text)] disabled:cursor-not-allowed disabled:opacity-40"
                title="Reset --mixed: move branch pointer to target ref, keep changes as unstaged"
              >
                Reset
              </button>
              <button
                onclick={() => {
                  if (selectedWorktree && actionRef)
                    handleResetWorktree(selectedWorktree, actionRef, 'hard');
                }}
                disabled={!actionRef}
                class="rounded border border-[var(--sg-danger)]/30 px-2 py-1 text-[10px] text-[var(--sg-danger)] hover:bg-[var(--sg-danger)]/10 disabled:cursor-not-allowed disabled:opacity-40"
                title="Reset --hard: move branch pointer to target ref and DISCARD all changes"
              >
                Hard reset
              </button>
            </div>
            <p class="mt-1 text-[9px] text-[var(--sg-text-faint)]">
              Right-click a commit in the graph for quick actions
            </p>
          </div>
        {/if}
      </aside>

      <!-- Main content area -->
      <section class="flex min-w-0 flex-1 flex-col overflow-hidden">
        <!-- View toggles (history / changes / terminal) -->
        {#if selectedWorktree && !activeIsRoot}
          <div
            class="flex items-center gap-1 border-b border-[var(--sg-border)] bg-[var(--sg-surface)] px-4"
          >
            <button
              onclick={() => (activeTab = 'history')}
              data-testid="tab-history"
              class="border-b-2 px-3 py-2 text-xs font-medium transition {activeTab === 'history'
                ? 'border-[var(--sg-primary)] text-[var(--sg-primary)]'
                : 'border-transparent text-[var(--sg-text-dim)] hover:text-[var(--sg-text)]'}"
            >
              History
            </button>
            <button
              onclick={() => (activeTab = 'changes')}
              data-testid="tab-changes"
              class="flex items-center gap-1.5 border-b-2 px-3 py-2 text-xs font-medium transition {activeTab ===
              'changes'
                ? 'border-[var(--sg-primary)] text-[var(--sg-primary)]'
                : 'border-transparent text-[var(--sg-text-dim)] hover:text-[var(--sg-text)]'}"
            >
              Changes
              {#if worktreeStatus.length > 0}
                <span
                  class="rounded-full bg-[var(--sg-warning)]/20 px-1.5 py-0.5 text-[9px] font-bold text-[var(--sg-warning)]"
                >
                  {worktreeStatus.length}
                </span>
              {/if}
            </button>
            <button
              onclick={() => (activeTab = 'terminal')}
              data-testid="tab-terminal"
              class="border-b-2 px-3 py-2 text-xs font-medium transition {activeTab === 'terminal'
                ? 'border-[var(--sg-primary)] text-[var(--sg-primary)]'
                : 'border-transparent text-[var(--sg-text-dim)] hover:text-[var(--sg-text)]'}"
            >
              Terminal
            </button>
          </div>
        {/if}

        {#if activeTab === 'changes' && selectedWorktree && !activeIsRoot}
          <!-- Staging View: left = file lists + commit form, right = always-visible diff panel -->
          <div class="flex min-h-0 flex-1">
            <!-- Left column: file lists + commit form -->
            <div
              class="flex w-[260px] shrink-0 flex-col overflow-hidden border-r border-[var(--sg-border-subtle)]"
            >
              {#if statusLoading}
                <div class="flex flex-1 items-center justify-center gap-2">
                  <Spinner size="md" />
                  <p class="text-xs text-[var(--sg-text-faint)]">Loading changes…</p>
                </div>
              {:else}
                <div
                  bind:this={splitContainerEl}
                  class="flex min-h-0 flex-1 flex-col overflow-hidden"
                  style:user-select={isDragSelecting || isSplitDragging ? 'none' : ''}
                >
                  <!-- Unstaged files -->
                  <div class="flex flex-col overflow-hidden" style:height="{splitPct}%">
                    <div class="flex min-h-0 flex-1 flex-col overflow-y-auto">
                      <div
                        class="sticky top-0 z-10 flex items-center justify-between bg-[var(--sg-surface)] px-3 py-1.5"
                      >
                        <p
                          class="text-[10px] font-semibold uppercase tracking-wider text-[var(--sg-text-faint)]"
                        >
                          Changes ({unstagedFiles.length})
                        </p>
                        {#if unstagedFiles.length > 0}
                          <button
                            onclick={() =>
                              hasMultiSelection
                                ? handleStageFiles(
                                    [...selectedFilePaths]
                                      .filter(k => k.startsWith('unstaged:'))
                                      .map(k => k.slice(9))
                                  )
                                : handleStageFiles(unstagedFiles.map(f => f.path))}
                            disabled={!!stagingAction}
                            data-testid="btn-stage-all"
                            class="text-[9px] text-[var(--sg-text-dim)] hover:text-[var(--sg-text)] disabled:opacity-40"
                            >{hasMultiSelection ? 'Stage selected' : 'Stage all'}</button
                          >
                        {/if}
                      </div>
                      {#if unstagedFiles.length === 0}
                        <p class="px-3 pb-2 text-[10px] text-[var(--sg-text-faint)]">
                          No unstaged changes
                        </p>
                      {:else}
                        {#each unstagedFiles as file}
                          <!-- svelte-ignore a11y_no_static_element_interactions -->
                          <!-- svelte-ignore a11y_click_events_have_key_events -->
                          <div
                            class="group flex cursor-pointer items-center gap-1 px-2 py-0.5 {selectedFilePaths.has(
                              `unstaged:${file.path}`
                            )
                              ? 'bg-[var(--sg-primary)]/10'
                              : stagingDiffFile === file.path && !stagingDiffStaged
                                ? 'bg-[var(--sg-surface-raised)]'
                                : 'hover:bg-[var(--sg-surface-raised)]'}"
                            data-testid="unstaged-file"
                            data-filepath={file.path}
                            onmousedown={e => handleFileMouseDown(e, `unstaged:${file.path}`)}
                            onmouseenter={() => handleFileMouseEnter(`unstaged:${file.path}`)}
                            onclick={e => handleFileClick(e, `unstaged:${file.path}`)}
                            title={file.path}
                          >
                            <div class="flex min-w-0 flex-1 items-center gap-1.5">
                              {@render fileStatusIcon(file.workTreeStatus)}
                              <span class="truncate text-[11px] text-[var(--sg-text-dim)]"
                                >{file.path}</span
                              >
                            </div>
                            <button
                              onclick={e => {
                                e.stopPropagation();
                                handleStageFiles([file.path]);
                              }}
                              disabled={stagingAction === file.path}
                              class="shrink-0 rounded p-0.5 text-[var(--sg-text-faint)] opacity-0 hover:bg-[var(--sg-surface)] hover:text-[var(--sg-primary)] group-hover:opacity-100 disabled:opacity-40"
                              title="Stage"
                            >
                              {#if stagingAction === file.path}
                                <Spinner size="sm" />
                              {:else}
                                <svg
                                  width="12"
                                  height="12"
                                  viewBox="0 0 24 24"
                                  fill="none"
                                  stroke="currentColor"
                                  stroke-width="2.5"
                                  stroke-linecap="round"
                                  ><line x1="12" y1="5" x2="12" y2="19" /><line
                                    x1="5"
                                    y1="12"
                                    x2="19"
                                    y2="12"
                                  /></svg
                                >
                              {/if}
                            </button>
                          </div>
                        {/each}
                      {/if}
                    </div>
                  </div>

                  <!-- Draggable divider -->
                  <!-- svelte-ignore a11y_no_static_element_interactions -->
                  <div
                    class="group relative z-10 flex h-[5px] shrink-0 cursor-row-resize items-center justify-center border-y border-[var(--sg-border-subtle)] bg-[var(--sg-surface)] hover:border-[var(--sg-primary)]/40 hover:bg-[var(--sg-primary)]/5 {isSplitDragging
                      ? 'border-[var(--sg-primary)]/40 bg-[var(--sg-primary)]/5'
                      : ''}"
                    onpointerdown={onSplitPointerDown}
                    onpointermove={onSplitPointerMove}
                    onpointerup={onSplitPointerUp}
                  >
                    <div
                      class="h-[3px] w-6 rounded-full bg-[var(--sg-border)] transition-colors group-hover:bg-[var(--sg-primary)]/50 {isSplitDragging
                        ? 'bg-[var(--sg-primary)]/50'
                        : ''}"
                    ></div>
                  </div>

                  <!-- Staged files -->
                  <div class="flex min-h-0 flex-1 flex-col overflow-hidden">
                    <div class="flex min-h-0 flex-1 flex-col overflow-y-auto">
                      <div
                        class="sticky top-0 z-10 flex items-center justify-between bg-[var(--sg-surface)] px-3 py-1.5"
                      >
                        <p
                          class="text-[10px] font-semibold uppercase tracking-wider text-[var(--sg-text-faint)]"
                        >
                          Staged ({stagedFiles.length})
                        </p>
                        {#if stagedFiles.length > 0}
                          <button
                            onclick={() =>
                              hasMultiSelection
                                ? handleUnstageFiles(
                                    [...selectedFilePaths]
                                      .filter(k => k.startsWith('staged:'))
                                      .map(k => k.slice(7))
                                  )
                                : handleUnstageFiles(stagedFiles.map(f => f.path))}
                            disabled={!!stagingAction}
                            class="text-[9px] text-[var(--sg-text-dim)] hover:text-[var(--sg-text)] disabled:opacity-40"
                            >{hasMultiSelection ? 'Unstage selected' : 'Unstage all'}</button
                          >
                        {/if}
                      </div>
                      {#if stagedFiles.length === 0}
                        <p class="px-3 pb-2 text-[10px] text-[var(--sg-text-faint)]">
                          No staged changes
                        </p>
                      {:else}
                        {#each stagedFiles as file}
                          <!-- svelte-ignore a11y_no_static_element_interactions -->
                          <!-- svelte-ignore a11y_click_events_have_key_events -->
                          <div
                            class="group flex cursor-pointer items-center gap-1 px-2 py-0.5 {selectedFilePaths.has(
                              `staged:${file.path}`
                            )
                              ? 'bg-[var(--sg-primary)]/10'
                              : stagingDiffFile === file.path && stagingDiffStaged
                                ? 'bg-[var(--sg-surface-raised)]'
                                : 'hover:bg-[var(--sg-surface-raised)]'}"
                            data-testid="staged-file"
                            data-filepath={file.path}
                            onmousedown={e => handleFileMouseDown(e, `staged:${file.path}`)}
                            onmouseenter={() => handleFileMouseEnter(`staged:${file.path}`)}
                            onclick={e => handleFileClick(e, `staged:${file.path}`)}
                            title={file.path}
                          >
                            <div class="flex min-w-0 flex-1 items-center gap-1.5">
                              {@render fileStatusIcon(file.indexStatus)}
                              <span class="truncate text-[11px] text-[var(--sg-text-dim)]"
                                >{file.path}</span
                              >
                            </div>
                            <button
                              onclick={e => {
                                e.stopPropagation();
                                handleUnstageFiles([file.path]);
                              }}
                              disabled={stagingAction === file.path}
                              class="shrink-0 rounded p-0.5 text-[var(--sg-text-faint)] opacity-0 hover:bg-[var(--sg-surface)] hover:text-[var(--sg-warning)] group-hover:opacity-100 disabled:opacity-40"
                              title="Unstage"
                            >
                              {#if stagingAction === file.path}
                                <Spinner size="sm" />
                              {:else}
                                <svg
                                  width="12"
                                  height="12"
                                  viewBox="0 0 24 24"
                                  fill="none"
                                  stroke="currentColor"
                                  stroke-width="2.5"
                                  stroke-linecap="round"
                                  ><line x1="5" y1="12" x2="19" y2="12" /></svg
                                >
                              {/if}
                            </button>
                          </div>
                        {/each}
                      {/if}
                    </div>
                  </div>
                </div>

                <!-- Commit form -->
                <div class="shrink-0 border-t border-[var(--sg-border)] px-3 py-2">
                  <textarea
                    bind:value={commitMessage}
                    placeholder="Commit message"
                    rows="3"
                    data-testid="commit-message"
                    onkeydown={e => {
                      if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
                        e.preventDefault();
                        handleCreateCommit();
                      }
                    }}
                    class="w-full resize-none rounded border border-[var(--sg-input-border)] bg-[var(--sg-input-bg)] px-2 py-1.5 text-xs text-[var(--sg-text)] placeholder-[var(--sg-text-faint)] outline-none focus:border-[var(--sg-input-focus)]"
                  ></textarea>
                  <button
                    onclick={handleCreateCommit}
                    disabled={committing || !commitMessage.trim() || stagedFiles.length === 0}
                    data-testid="btn-commit"
                    class="mt-1.5 flex w-full items-center justify-center gap-2 rounded bg-[var(--sg-primary)] px-2.5 py-1.5 text-xs font-semibold text-[var(--sg-bg)] hover:bg-[var(--sg-primary-hover)] disabled:cursor-not-allowed disabled:opacity-40"
                    title={stagedFiles.length === 0
                      ? 'Stage changes first'
                      : 'Commit staged changes'}
                  >
                    {#if committing}
                      <Spinner size="sm" /> Committing…
                    {:else}
                      Commit{stagedFiles.length > 0 ? ` (${stagedFiles.length})` : ''}
                    {/if}
                  </button>
                  <p class="mt-1 text-center text-[9px] text-[var(--sg-text-faint)]">
                    Ctrl+Enter to commit · Enter for new line
                  </p>
                </div>
              {/if}
            </div>

            <!-- Right column: always-visible diff panel -->
            <div class="flex min-w-0 flex-1 flex-col overflow-hidden bg-[var(--sg-bg)]">
              {#if hasMultiSelection}
                <div
                  class="flex flex-1 flex-col items-center justify-center gap-1.5 px-4 text-center"
                >
                  <p class="text-xs font-medium text-[var(--sg-text-dim)]">
                    {selectedFilePaths.size} files selected
                  </p>
                  <p class="text-[10px] text-[var(--sg-text-faint)]">
                    Use "Stage selected" or "Unstage selected" to act on all selected files at once.
                  </p>
                </div>
              {:else if stagingDiffFile}
                <!-- Diff header -->
                <div
                  data-testid="diff-panel-header"
                  class="flex shrink-0 items-center gap-2 border-b border-[var(--sg-border-subtle)] bg-[var(--sg-surface)] px-3 py-1.5"
                >
                  <span
                    class="rounded-sm px-1 py-px text-[9px] font-bold {stagingDiffStaged
                      ? 'bg-[var(--sg-primary)]/15 text-[var(--sg-primary)]'
                      : 'bg-[var(--sg-warning)]/15 text-[var(--sg-warning)]'}"
                  >
                    {stagingDiffStaged ? 'STAGED' : 'UNSTAGED'}
                  </span>
                  {#if stagingDiffOrigPath}
                    <span class="truncate font-mono text-[11px] text-[var(--sg-text-faint)]"
                      >{stagingDiffOrigPath}</span
                    >
                    <svg
                      class="h-3 w-3 shrink-0 text-[var(--sg-text-faint)]"
                      viewBox="0 0 16 16"
                      fill="none"
                      stroke="currentColor"
                      stroke-width="2"
                      stroke-linecap="round"
                      stroke-linejoin="round"><path d="M3 8h10M9 4l4 4-4 4" /></svg
                    >
                    <span class="truncate font-mono text-[11px] text-[var(--sg-text-dim)]"
                      >{stagingDiffFile}</span
                    >
                  {:else}
                    <span class="truncate font-mono text-[11px] text-[var(--sg-text-dim)]"
                      >{stagingDiffFile}</span
                    >
                  {/if}
                </div>
                <!-- Syntax-highlighted diff content (shared DiffViewer component, minimal mode) -->
                <DiffViewer
                  diff={stagingDiffContent}
                  loading={stagingDiffLoading}
                  filePath={stagingDiffFile}
                />
              {:else}
                <div class="flex flex-1 items-center justify-center">
                  <p class="text-xs text-[var(--sg-text-faint)]">Select a file to view its diff</p>
                </div>
              {/if}
            </div>
          </div>
        {:else if activeTab === 'history' || !selectedWorktree || activeIsRoot}
          <!-- Commit graph -->
          <div class="flex min-h-0 {selectedCommits.length > 0 ? 'h-1/2' : 'flex-1'} flex-col">
            <div
              class="flex items-center justify-between border-b border-[var(--sg-border-subtle)] bg-[var(--sg-surface)] px-4 py-2"
            >
              <div class="flex items-center gap-2">
                <p
                  class="text-[10px] font-semibold uppercase tracking-wider text-[var(--sg-text-faint)]"
                >
                  Commit graph
                </p>
                {#if selectedCommits.length > 0}
                  <span class="text-[10px] text-[var(--sg-primary)]">
                    {selectedCommits.length === 1
                      ? '1 commit selected'
                      : `${selectedCommits.length} commits selected`}
                  </span>
                {/if}
              </div>
              <span class="text-[10px] text-[var(--sg-text-faint)]">
                {#if graphHasMore && totalCommitCount !== null}
                  Showing {(graph?.commits.length ?? 0).toLocaleString()} of {totalCommitCount.toLocaleString()}
                  commits
                {:else if graphHasMore}
                  {(graph?.commits.length ?? 0).toLocaleString()}+ commits
                {:else}
                  {(graph?.commits.length ?? 0).toLocaleString()} commits
                {/if}
              </span>
            </div>

            <div class="flex flex-1 flex-col overflow-hidden bg-[var(--sg-bg)]">
              {#if loading}
                <div
                  class="flex flex-1 items-center justify-center gap-2"
                  style="animation: sg-fade-in 0.3s ease-out"
                >
                  <Spinner size="md" />
                  <p class="text-xs text-[var(--sg-text-faint)]">Loading commit history…</p>
                </div>
              {:else}
                <CommitGraph
                  commits={graph?.commits ?? []}
                  {worktrees}
                  activeWorktree={selectedWorktree && !activeIsRoot ? selectedWorktree : null}
                  oncreateworktree={handleCreateWorktreeFromGraph}
                  oncheckout={handleGraphCheckout}
                  onreset={handleGraphReset}
                  onselect={handleCommitSelect}
                  hasmore={graphHasMore}
                  loadingmore={graphLoadingMore}
                  onloadmore={loadMoreGraphCommits}
                />
              {/if}
            </div>
          </div>

          <!-- Diff viewer (shown when commits selected) -->
          {#if selectedCommits.length > 0}
            <div
              class="flex min-h-0 flex-1 flex-col border-t border-[var(--sg-border)]"
              style="animation: sg-slide-up 0.15s ease-out"
            >
              <DiffViewer
                files={diffFiles}
                selectedFile={diffSelectedFile}
                diff={diffContent}
                loading={diffLoading}
                commitLabel={diffCommitLabel}
                commits={selectedCommits}
                onselectfile={handleDiffFileSelect}
                onclose={closeDiffViewer}
              />
            </div>
          {/if}
        {:else}
          <!-- Root worktree (protected) message, or terminal tab with no shell -->
          {#if activeTab === 'terminal' && !defaultShell}
            <div class="flex flex-1 items-center justify-center">
              <p class="text-sm text-[var(--sg-text-faint)]">No shell detected on this system</p>
            </div>
          {:else if activeTab !== 'terminal'}
            <div class="flex flex-1 items-center justify-center">
              <p class="text-sm text-[var(--sg-text-faint)]">Select a worktree to view changes</p>
            </div>
          {/if}
        {/if}

        <!-- Terminal containers: lazily initialized, never unmounted once created.
             display:none hides them when the terminal tab is not active,
             preserving all PTY sessions across tab and worktree switches. -->
        {#each [...terminalInitializedPaths] as wtPath (wtPath)}
          <div
            class="flex min-h-0 flex-1 flex-col overflow-hidden"
            style:display={activeTab === 'terminal' && activeWorktreePath === wtPath
              ? 'flex'
              : 'none'}
          >
            <TerminalContainer
              {defaultShell}
              {availableShells}
              cwd={wtPath}
              launchRequest={hookTerminalLaunchRequest}
            />
          </div>
        {/each}
      </section>
    </div>
  {/if}
</main>

{#if confirmDialog}
  <ConfirmDialog
    title={confirmDialog.title}
    message={confirmDialog.message}
    confirmLabel={confirmDialog.confirmLabel}
    danger={confirmDialog.danger}
    onconfirm={confirmDialog.onconfirm}
    oncancel={() => (confirmDialog = null)}
  />
{/if}

{#if operationStatus}
  <div class="fixed inset-0 z-[80] bg-black/45"></div>
  <div
    class="fixed inset-0 z-[90] flex items-center justify-center p-4"
    style="animation: sg-fade-in 0.2s ease-out"
  >
    <div
      class="w-[min(940px,98vw)] rounded-xl border border-[var(--sg-border)] bg-[var(--sg-surface)] px-4 py-4 shadow-xl"
    >
      <div class="flex items-center gap-3">
        {#if operationCompleted}
          <div
            class="flex h-8 w-8 items-center justify-center rounded-full border border-[var(--sg-primary)]/40 bg-[var(--sg-primary)]/15 text-[var(--sg-primary)]"
          >
            <svg
              class="h-4 w-4"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              stroke-width="2"
              stroke-linecap="round"
              stroke-linejoin="round"
            >
              <path d="m5 12 5 5L20 7"></path>
            </svg>
          </div>
        {:else}
          <Spinner size="md" />
        {/if}
        <div>
          <p class="text-sm font-semibold text-[var(--sg-text)]">{operationStatus.title}</p>
          <p class="mt-0.5 text-xs text-[var(--sg-text-dim)]">
            {#if operationCompleted}
              {operationStatus.detail} Completed.
            {:else}
              {operationStatus.detail}
            {/if}
          </p>
        </div>
      </div>
      {#if activeHookName}
        <p class="mt-3 text-xs text-[var(--sg-primary)]">Running hook: {activeHookName}</p>
      {/if}
      {#if operationError}
        <div
          class="mt-3 rounded border border-[var(--sg-danger)]/35 bg-[var(--sg-danger)]/10 px-3 py-2"
        >
          <p class="text-xs font-medium text-[var(--sg-danger)]">Operation failed</p>
          <p class="mt-0.5 text-[11px] text-[var(--sg-text-dim)]">{operationError}</p>
        </div>
      {/if}
      <div class="mt-3 grid gap-3 lg:grid-cols-[1.2fr,1fr]">
        <div
          class="max-h-[340px] overflow-auto rounded border border-[var(--sg-border-subtle)] bg-[var(--sg-surface-raised)] p-2.5"
        >
          <div class="mb-2 flex flex-wrap items-center gap-1.5 text-[10px]">
            <span
              class="rounded border border-[var(--sg-border)] bg-[var(--sg-surface)] px-1.5 py-px text-[var(--sg-text-faint)]"
              >Pending: {hookStatusSummary.pending}</span
            >
            <span
              class="rounded border border-[var(--sg-accent)]/40 bg-[var(--sg-accent)]/15 px-1.5 py-px text-[var(--sg-accent)]"
              >Running: {hookStatusSummary.running}</span
            >
            <span
              class="rounded border border-[var(--sg-primary)]/40 bg-[var(--sg-primary)]/15 px-1.5 py-px text-[var(--sg-primary)]"
              >Complete: {hookStatusSummary.success}</span
            >
            <span
              class="rounded border border-[var(--sg-warning)]/40 bg-[var(--sg-warning)]/15 px-1.5 py-px text-[var(--sg-warning)]"
              >Skipped: {hookStatusSummary.skipped}</span
            >
            <span
              class="rounded border border-[var(--sg-danger)]/40 bg-[var(--sg-danger)]/15 px-1.5 py-px text-[var(--sg-danger)]"
              >Errors: {hookStatusSummary.error + hookStatusSummary.timed_out}</span
            >
          </div>
          {#if operationHooks.length === 0}
            <p class="text-[10px] text-[var(--sg-text-faint)]">
              No hooks registered for this operation.
            </p>
          {:else}
            <div class="space-y-2">
              {#each operationHooks as hook (hook.id)}
                <div class="rounded border border-[var(--sg-border)] bg-[var(--sg-surface)] p-2">
                  <div class="flex items-start justify-between gap-2">
                    <div class="min-w-0">
                      <p class="truncate text-xs font-medium text-[var(--sg-text)]">{hook.name}</p>
                      <p class="mt-0.5 text-[10px] text-[var(--sg-text-faint)]">{hook.trigger}</p>
                    </div>
                    <span
                      class={`shrink-0 rounded border px-1.5 py-px text-[10px] ${statusBadgeClass(hook.status)}`}
                    >
                      {statusLabel(hook.status)}
                    </span>
                  </div>
                  <div
                    class="mt-1.5 max-h-24 overflow-auto rounded border border-[var(--sg-border-subtle)] bg-[var(--sg-bg)] p-1.5"
                  >
                    {#if hook.logs.length === 0}
                      <p class="text-[10px] text-[var(--sg-text-faint)]">Waiting for output...</p>
                    {:else}
                      <pre
                        class="whitespace-pre-wrap break-words font-mono text-[10px] leading-relaxed text-[var(--sg-text-dim)]">{hook.logs.join(
                          '\n\n'
                        )}</pre>
                    {/if}
                  </div>
                </div>
              {/each}
            </div>
          {/if}
        </div>

        <div
          class="max-h-[340px] overflow-auto rounded border border-[var(--sg-border-subtle)] bg-[var(--sg-surface-raised)] p-2.5"
        >
          <p
            class="mb-1 text-[10px] font-semibold uppercase tracking-wider text-[var(--sg-text-faint)]"
          >
            Operation Timeline
          </p>
          {#if operationLogs.length === 0}
            <p class="text-[10px] text-[var(--sg-text-faint)]">Waiting for hook output...</p>
          {:else}
            <pre
              class="whitespace-pre-wrap break-words font-mono text-[10px] leading-relaxed text-[var(--sg-text-dim)]">{operationLogs.join(
                '\n'
              )}</pre>
          {/if}
        </div>
      </div>
      {#if operationError || operationCompleted}
        <div class="mt-3 flex justify-end">
          <button
            onclick={() => endOperation(true)}
            class="rounded border border-[var(--sg-border)] px-2.5 py-1 text-xs text-[var(--sg-text-dim)] hover:bg-[var(--sg-surface-raised)] hover:text-[var(--sg-text)]"
          >
            {operationError ? 'Dismiss' : 'Close'}
          </button>
        </div>
      {:else}
        <p class="mt-3 text-[10px] text-[var(--sg-text-faint)]">
          Please wait. This can include lifecycle hooks and git operations.
        </p>
      {/if}
    </div>
  </div>
{/if}

<WorkspaceHooksModal
  open={hooksModalOpen}
  workspacePath={workspace?.workspacePath ?? ''}
  onClose={() => {
    hooksModalOpen = false;
  }}
/>

{#if worktreeContextMenu}
  <ContextMenu
    items={worktreeContextMenu.items}
    x={worktreeContextMenu.x}
    y={worktreeContextMenu.y}
    onclose={() => (worktreeContextMenu = null)}
  />
{/if}
