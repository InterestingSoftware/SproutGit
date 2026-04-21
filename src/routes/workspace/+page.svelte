<script lang="ts">
  import { onDestroy } from "svelte";
  import { goto } from "$app/navigation";
  import { page } from "$app/stores";
  import Autocomplete from "$lib/components/Autocomplete.svelte";
  import CommitGraph from "$lib/components/CommitGraph.svelte";
  import ConfirmDialog from "$lib/components/ConfirmDialog.svelte";
  import ContextMenu, { type MenuItem } from "$lib/components/ContextMenu.svelte";
  import DiffViewer from "$lib/components/DiffViewer.svelte";
  import Spinner from "$lib/components/Spinner.svelte";
  import WorkspaceHooksModal from "$lib/components/WorkspaceHooksModal.svelte";
  import {
    checkoutWorktree,
    createManagedWorktree,
    deleteManagedWorktree,
    getCommitGraph,
    getDiffContent,
    getDiffFiles,
    inspectWorkspace,
    listWorkspaceHooks,
    listRefs,
    listWorktrees,
    openInEditor,
    onHookProgress,
    resetWorktreeBranch,
    runWorkspaceHook,
    type CommitEntry,
    type CommitGraphResult,
    type DiffFileEntry,
    type RefInfo,
    type HookProgressEvent,
    type WorkspaceHook,
    type WorkspaceHookTrigger,
    type WorkspaceStatus,
    type WorktreeInfo,
  } from "$lib/sproutgit";
  import { toast } from "$lib/toast.svelte";
  import { validateBranchName, validateSourceRef } from "$lib/validation";
  import { openPath } from "@tauri-apps/plugin-opener";
  import {
    FolderOpen,
    Play,
    Trash2,
    SquareTerminal,
    ShieldAlert,
    Settings,
  } from "lucide-svelte";
  import WindowControls from "$lib/components/WindowControls.svelte";

  const GRAPH_PAGE_SIZE = 2000;

  let workspace = $state<WorkspaceStatus | null>(null);
  let worktrees = $state<WorktreeInfo[]>([]);
  let graph = $state<CommitGraphResult | null>(null);
  let refs = $state<RefInfo[]>([]);
  let selectedRef = $state("");
  let newBranch = $state("");
  let activeWorktreePath = $state<string | null>(null);
  let graphSkip = $state(0);
  let graphHasMore = $state(false);
  let graphLoadingMore = $state(false);
  let graphSeenHashes = new Set<string>();
  let loading = $state(true);
  let creating = $state(false);
  let deleting = $state<string | null>(null);
  let error = $state("");

  // Confirm dialog state
  type ConfirmState = {
    title: string;
    message: string;
    confirmLabel: string;
    danger: boolean;
    onconfirm: () => void;
  } | null;
  let confirmDialog = $state<ConfirmState>(null);
  let actionRef = $state("");
  let formTouched = $state({ branch: false, ref: false });

  // Diff viewer state
  let selectedCommits = $state<CommitEntry[]>([]);
  let diffFiles = $state<DiffFileEntry[]>([]);
  let diffContent = $state("");
  let diffSelectedFile = $state<string | null>(null);
  let diffLoading = $state(false);

  // Worktree context menu
  let worktreeContextMenu = $state<{ x: number; y: number; items: MenuItem[] } | null>(null);
  let hooksModalOpen = $state(false);
  let operationStatus = $state<{ title: string; detail: string } | null>(null);
  let operationError = $state<string | null>(null);
  let activeHookName = $state<string | null>(null);
  let operationLogs = $state<string[]>([]);

  type OperationHookStatus = "pending" | "running" | "success" | "skipped" | "timed_out" | "error";
  type OperationHookState = {
    id: string;
    name: string;
    trigger: string;
    status: OperationHookStatus;
    logs: string[];
  };

  let operationHooks = $state<OperationHookState[]>([]);

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
      case "pending":
        return "Pending";
      case "running":
        return "Running";
      case "success":
        return "Complete";
      case "skipped":
        return "Skipped";
      case "timed_out":
        return "Timed out";
      case "error":
        return "Error";
      default:
        return status;
    }
  }

  function statusBadgeClass(status: OperationHookStatus): string {
    switch (status) {
      case "pending":
        return "border-[var(--sg-border)] bg-[var(--sg-surface-raised)] text-[var(--sg-text-faint)]";
      case "running":
        return "border-[var(--sg-accent)]/40 bg-[var(--sg-accent)]/15 text-[var(--sg-accent)]";
      case "success":
        return "border-[var(--sg-primary)]/40 bg-[var(--sg-primary)]/15 text-[var(--sg-primary)]";
      case "skipped":
        return "border-[var(--sg-warning)]/40 bg-[var(--sg-warning)]/15 text-[var(--sg-warning)]";
      case "timed_out":
        return "border-[var(--sg-danger)]/40 bg-[var(--sg-danger)]/15 text-[var(--sg-danger)]";
      case "error":
        return "border-[var(--sg-danger)]/40 bg-[var(--sg-danger)]/15 text-[var(--sg-danger)]";
      default:
        return "border-[var(--sg-border)] bg-[var(--sg-surface-raised)] text-[var(--sg-text-faint)]";
    }
  }

  function mapEventStatus(event: HookProgressEvent): OperationHookStatus {
    if (event.phase === "start") return "running";
    if (event.phase === "skipped") return "skipped";
    if (event.status === "success") return "success";
    if (event.status === "timed_out") return "timed_out";
    return "error";
  }

  function updateHookState(hookId: string, updater: (current: OperationHookState) => OperationHookState) {
    const idx = operationHooks.findIndex((hook) => hook.id === hookId);
    if (idx < 0) return;
    const current = operationHooks[idx];
    const next = updater(current);
    operationHooks = [
      ...operationHooks.slice(0, idx),
      next,
      ...operationHooks.slice(idx + 1),
    ];
  }

  function ensureHookState(event: HookProgressEvent): OperationHookState {
    const existing = operationHooks.find((hook) => hook.id === event.hookId);
    if (existing) return existing;

    const created: OperationHookState = {
      id: event.hookId,
      name: event.hookName,
      trigger: event.trigger,
      status: "pending",
      logs: [],
    };

    operationHooks = [...operationHooks, created];
    return created;
  }

  function appendOperationLog(line: string) {
    operationLogs = [...operationLogs, line];
  }

  function toOperationHookState(hook: Pick<WorkspaceHook, "id" | "name" | "trigger">): OperationHookState {
    return {
      id: hook.id,
      name: hook.name,
      trigger: hook.trigger,
      status: "pending",
      logs: [],
    };
  }

  function sortHooksByTriggerAndName<T extends { trigger: string; name: string }>(hooks: T[]): T[] {
    return [...hooks].sort((a, b) => {
      if (a.trigger !== b.trigger) return a.trigger.localeCompare(b.trigger);
      return a.name.localeCompare(b.name);
    });
  }

  function collectHookClosure(allHooks: WorkspaceHook[], rootHookId: string): WorkspaceHook[] {
    const hooksById = new Map(allHooks.map((hook) => [hook.id, hook]));
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
        .map((hookId) => hooksById.get(hookId))
        .filter((hook): hook is WorkspaceHook => Boolean(hook)),
    );
  }

  async function beginOperation(
    title: string,
    detail: string,
    triggers: WorkspaceHookTrigger[] = [],
    preloadedHooks: Array<Pick<WorkspaceHook, "id" | "name" | "trigger">> = [],
  ) {
    operationStatus = { title, detail };
    operationError = null;
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
        triggers.map((trigger) => listWorkspaceHooks(workspacePath, trigger)),
      );

      const seen = new Set<string>();
      const hooks: Array<Pick<WorkspaceHook, "id" | "name" | "trigger">> = [];

      for (const triggerHooks of hookLists) {
        for (const hook of triggerHooks) {
          if (seen.has(hook.id)) continue;
          seen.add(hook.id);
          hooks.push({ id: hook.id, name: hook.name, trigger: hook.trigger });
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
    if (operationError && !force) return;
    operationStatus = null;
    operationError = null;
    activeHookName = null;
    operationHooks = [];
  }

  function handleHookProgress(event: HookProgressEvent) {
    if (!operationStatus) return;

    ensureHookState(event);
    const nextStatus = mapEventStatus(event);

    if (event.phase === "start") {
      activeHookName = event.hookName;
      appendOperationLog(`▶ ${event.hookName} (${event.trigger})`);
      updateHookState(event.hookId, (current) => ({
        ...current,
        name: event.hookName,
        trigger: event.trigger,
        status: nextStatus,
        logs: [...current.logs, "Started"],
      }));
      return;
    }

    if (event.phase === "skipped") {
      appendOperationLog(`⏭ ${event.hookName} skipped`);
      updateHookState(event.hookId, (current) => ({
        ...current,
        name: event.hookName,
        trigger: event.trigger,
        status: nextStatus,
        logs: event.errorMessage
          ? [...current.logs, `Skipped: ${event.errorMessage}`]
          : [...current.logs, "Skipped"],
      }));
      if (event.errorMessage?.trim()) {
        appendOperationLog(`  error: ${event.errorMessage}`);
      }
      return;
    }

    appendOperationLog(
      `${event.status === "success" ? "✓" : "✗"} ${event.hookName} (${event.status})`,
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

    updateHookState(event.hookId, (current) => ({
      ...current,
      name: event.hookName,
      trigger: event.trigger,
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
    worktrees.find((item) => item.path === workspace?.rootPath) ?? null,
  );

  const nonRootWorktrees = $derived(
    worktrees.filter((item) => item.path !== workspace?.rootPath),
  );

  const selectedWorktree = $derived(
    worktrees.find((item) => item.path === activeWorktreePath) ?? null,
  );

  const refItems = $derived(
    refs.map((r) => ({ label: r.name, value: r.name, detail: r.kind })),
  );

  function initializeGraphState(nextGraph: CommitGraphResult) {
    graph = nextGraph;
    graphSkip = nextGraph.commits.length;
    graphHasMore = nextGraph.commits.length === GRAPH_PAGE_SIZE;
    graphSeenHashes = new Set(nextGraph.commits.map((commit) => commit.hash));
  }

  async function loadWorkspace() {
    loading = true;
    error = "";

    try {
      const workspacePath = $page.url.searchParams.get("workspace")?.trim();
      if (!workspacePath) {
        throw new Error("Missing workspace path. Open a project from the home screen.");
      }

      const status = await inspectWorkspace(workspacePath);
      if (!status.isSproutgitProject) {
        throw new Error("Path is not a SproutGit project.");
      }

      workspace = status;

      const [worktreeData, refsData, graphData] = await Promise.all([
        listWorktrees(status.rootPath),
        listRefs(status.rootPath),
        getCommitGraph(status.rootPath, GRAPH_PAGE_SIZE, 0),
      ]);

      worktrees = worktreeData.worktrees;
      refs = refsData.refs;
      initializeGraphState(graphData);
      selectedRef = refsData.refs[0]?.name ?? "HEAD";
      activeWorktreePath = worktreeData.worktrees[0]?.path ?? null;
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
    error = "";

    try {
      await beginOperation(
        "Creating worktree",
        "Running hooks and creating the managed worktree...",
        ["before_worktree_create", "after_worktree_create"],
      );

      const currentWorkspace = workspace;
      if (!currentWorkspace) {
        throw new Error("Workspace context is unavailable");
      }

      const result = await createManagedWorktree(
        currentWorkspace.rootPath,
        currentWorkspace.worktreesPath,
        selectedRef,
        newBranch,
      );

      toast.success(`Worktree created: ${result.branch}`);

      await refreshWorkspaceData();
      activeWorktreePath =
        worktrees.find((wt) => wt.path !== currentWorkspace.rootPath)?.path ??
        worktrees[0]?.path ??
        null;
      newBranch = "";
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
  onDestroy(() => {
    void unlistenHookProgress.then((unlisten) => unlisten());
  });

  function handleCreateWorktreeFromGraph(fromRef: string) {
    selectedRef = fromRef;
    newBranch = "";
    // Focus the new branch input after state update
    requestAnimationFrame(() => {
      document.getElementById("new-branch")?.focus();
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
    return trigger === "manual" ? "manual" : trigger.replaceAll("_", " ");
  }

  async function openRunHookMenu(wt: WorktreeInfo, anchor: HTMLElement) {
    if (!workspace) return;

    try {
      const availableHooks = (await listWorkspaceHooks(workspace.workspacePath)).filter(
        (hook) => hook.enabled,
      );

      if (availableHooks.length === 0) {
        toast.info("No enabled hooks are available to run");
        return;
      }

      const manualHooks = sortHooksByTriggerAndName(
        availableHooks.filter((hook) => hook.trigger === "manual"),
      );
      const lifecycleHooks = sortHooksByTriggerAndName(
        availableHooks.filter((hook) => hook.trigger !== "manual"),
      );
      const items: MenuItem[] = [];

      for (const hook of manualHooks) {
        items.push({
          label: hook.name,
          icon: "▶",
          action: () => void handleRunHook(wt, hook, availableHooks),
        });
      }

      if (manualHooks.length > 0 && lifecycleHooks.length > 0) {
        items.push({ separator: true });
      }

      for (const hook of lifecycleHooks) {
        items.push({
          label: `${hook.name} (${formatHookTrigger(hook.trigger)})`,
          icon: "▶",
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
    availableHooks: WorkspaceHook[],
  ) {
    if (!workspace) return;

    worktreeContextMenu = null;
    const closureHooks = collectHookClosure(availableHooks, hook.id);
    const label = wt.branch ?? wt.path.split("/").pop() ?? "worktree";

    try {
      await beginOperation(
        "Running hook",
        `Executing ${hook.name} for ${label}...`,
        [],
        closureHooks,
      );
      await runWorkspaceHook(workspace.workspacePath, hook.id, wt.path);
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
    const label = wt.branch ?? wt.path.split("/").pop() ?? "worktree";
    confirmDialog = {
      title: "Delete worktree",
      message: `Delete worktree "${label}"? This will remove the directory and prune the worktree.`,
      confirmLabel: "Delete",
      danger: true,
      onconfirm: async () => {
        confirmDialog = null;
        deleting = wt.path;
        try {
          await beginOperation(
            "Removing worktree",
            "Running hooks and removing worktree files...",
            ["before_worktree_remove", "after_worktree_remove"],
          );
          await deleteManagedWorktree(workspace!.rootPath, wt.path, true);
          toast.success(`Deleted worktree: ${label}`);
          await refreshWorkspaceData();
          if (activeWorktreePath === wt.path) {
            activeWorktreePath =
              worktrees.find((w) => w.path !== workspace!.rootPath)?.path ??
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
    const [refreshedWt, refreshedGraph, refreshedRefs] = await Promise.all([
      listWorktrees(workspace.rootPath),
      getCommitGraph(workspace.rootPath, GRAPH_PAGE_SIZE, 0),
      listRefs(workspace.rootPath),
    ]);
    worktrees = refreshedWt.worktrees;
    initializeGraphState(refreshedGraph);
    refs = refreshedRefs.refs;
  }

  async function loadMoreGraphCommits() {
    if (!workspace || graphLoadingMore || !graphHasMore) return;

    graphLoadingMore = true;
    try {
      const nextPage = await getCommitGraph(workspace.rootPath, GRAPH_PAGE_SIZE, graphSkip);
      if (!graph) {
        initializeGraphState(nextPage);
      } else {
        const newCommits = nextPage.commits.filter((commit) => !graphSeenHashes.has(commit.hash));
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
    const label = wt.branch ?? "worktree";
    confirmDialog = {
      title: "Checkout branch",
      message: `Switch worktree "${label}" to ${targetRef}? Uncommitted changes will be auto-stashed.`,
      confirmLabel: "Checkout",
      danger: false,
      onconfirm: async () => {
        confirmDialog = null;
        try {
          await beginOperation(
            "Switching worktree",
            "Running hooks and switching branch...",
            ["before_worktree_switch", "after_worktree_switch"],
          );
          const result = await checkoutWorktree(wt.path, targetRef, true);
          if (result.stashed) {
            toast.warning(`Checked out ${result.newBranch} — changes were stashed (may need manual resolve)`);
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

  async function handleResetWorktree(wt: WorktreeInfo, targetRef: string, mode: "soft" | "mixed" | "hard") {
    if (!workspace) return;
    const label = wt.branch ?? "worktree";
    const modeDesc = mode === "hard"
      ? "This will discard all uncommitted changes."
      : mode === "mixed"
        ? "This will unstage changes but keep working directory modifications."
        : "This will only move the branch pointer.";
    confirmDialog = {
      title: `Reset branch (${mode})`,
      message: `Reset "${label}" to ${targetRef}? ${modeDesc}`,
      confirmLabel: `Reset ${mode}`,
      danger: mode === "hard",
      onconfirm: async () => {
        confirmDialog = null;
        try {
          await beginOperation("Resetting branch", `Applying ${mode} reset to ${targetRef}...`);
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
    if (!selectedWorktree || activeWorktreePath === workspace?.rootPath) return;
    handleCheckoutWorktree(selectedWorktree, targetRef);
  }

  function handleGraphReset(targetRef: string, mode: "soft" | "mixed" | "hard") {
    if (!selectedWorktree || activeWorktreePath === workspace?.rootPath) return;
    handleResetWorktree(selectedWorktree, targetRef, mode);
  }

  // ── Commit selection → diff loading ──
  async function handleCommitSelect(commits: CommitEntry[]) {
    selectedCommits = commits;
    diffFiles = [];
    diffContent = "";
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
          const aIdx = graph?.commits.findIndex((c) => c.hash === a.hash) ?? 0;
          const bIdx = graph?.commits.findIndex((c) => c.hash === b.hash) ?? 0;
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
        const result = await getDiffContent(workspace.rootPath, selectedCommits[0].hash, null, filePath);
        diffContent = result.diff;
      } else {
        const sorted = [...selectedCommits].sort((a, b) => {
          const aIdx = graph?.commits.findIndex((c) => c.hash === a.hash) ?? 0;
          const bIdx = graph?.commits.findIndex((c) => c.hash === b.hash) ?? 0;
          return bIdx - aIdx;
        });
        const oldest = sorted[0];
        const newest = sorted[sorted.length - 1];
        const result = await getDiffContent(workspace.rootPath, newest.hash, oldest.hash, filePath);
        diffContent = result.diff;
      }
    } catch (err) {
      toast.error(`Failed to load diff: ${err}`);
      diffContent = "";
    } finally {
      diffLoading = false;
    }
  }

  function closeDiffViewer() {
    selectedCommits = [];
    diffFiles = [];
    diffContent = "";
    diffSelectedFile = null;
  }

  const diffCommitLabel = $derived.by(() => {
    if (selectedCommits.length === 0) return "";
    if (selectedCommits.length === 1) return selectedCommits[0].shortHash;
    return `${selectedCommits.length} commits`;
  });

  // ── Worktree list context menu ──
  function handleWorktreeContextMenu(wt: WorktreeInfo, e: MouseEvent) {
    e.preventDefault();
    const label = wt.branch ?? wt.path.split("/").pop() ?? "worktree";
    const items: MenuItem[] = [
      { label: "Open folder", icon: "📂", action: () => handleRevealWorktree(wt.path) },
      { separator: true },
    ];
    if (wt.branch && !wt.detached) {
      items.push({
        label: "Checkout…",
        icon: "⎋",
        action: () => {
          activeWorktreePath = wt.path;
          actionRef = "";
          // Focus the action ref input
          requestAnimationFrame(() => document.getElementById("action-ref")?.focus());
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

<main class="flex h-screen flex-col">
  <!-- Context header -->
  <header data-tauri-drag-region class="flex shrink-0 items-center gap-3 border-b border-[var(--sg-border)] bg-[var(--sg-surface)] pt-1 pr-1 pb-1 pl-[var(--sg-titlebar-inset)]">
    <button onclick={() => goto("/")} class="rounded px-2 py-0.5 text-xs text-[var(--sg-text-dim)] hover:bg-[var(--sg-surface-raised)] hover:text-[var(--sg-text)]">
      &larr; Projects
    </button>
    <div class="h-3 w-px bg-[var(--sg-border)]"></div>
    <span class="text-xs text-[var(--sg-text)]">{workspace?.workspacePath.split("/").pop() ?? "..."}</span>
    <span class="text-xs text-[var(--sg-text-faint)]">&rsaquo;</span>
    <span class="text-xs text-[var(--sg-primary)]">
      {selectedWorktree?.branch ?? (selectedWorktree?.detached ? "detached" : "—")}
    </span>
    <div class="ml-auto flex items-center">
      <button
        onclick={() =>
          goto(
            workspace?.workspacePath
              ? `/settings?workspace=${encodeURIComponent(workspace.workspacePath)}`
              : "/settings",
          )}
        class="rounded p-1 text-[var(--sg-text-faint)] hover:bg-[var(--sg-surface-raised)] hover:text-[var(--sg-text)]"
        title="Settings"
      >
        <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"/></svg>
      </button>
      <WindowControls />
    </div>
  </header>

  {#if loading}
    <div class="flex flex-1 flex-col items-center justify-center gap-3" style="animation: sg-fade-in 0.3s ease-out">
      <Spinner size="lg" />
      <p class="text-sm text-[var(--sg-text-faint)]">Loading workspace…</p>
    </div>
  {:else}
    {#if error}
      <div class="border-b border-[var(--sg-border)] bg-[var(--sg-surface-raised)] px-4 py-2 text-xs text-[var(--sg-danger)]" style="animation: sg-slide-down 0.2s ease-out">{error}</div>
    {/if}

    <div class="flex min-h-0 flex-1" style="animation: sg-fade-in 0.3s ease-out">
      <!-- Left sidebar -->
      <aside class="flex w-[260px] shrink-0 flex-col border-r border-[var(--sg-border)] bg-[var(--sg-surface)]">
        <!-- Root info -->
        <div class="border-b border-[var(--sg-border-subtle)] px-3 py-2">
          <div class="flex items-center gap-1.5">
            <p class="text-[10px] font-semibold uppercase tracking-wider text-[var(--sg-text-faint)]">Root</p>
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
          <p class="mt-0.5 truncate text-xs text-[var(--sg-text-dim)]">{workspace?.rootPath ?? "—"}</p>
        </div>

        <!-- Create worktree form -->
        <form onsubmit={createFirstWorktree} class="border-b border-[var(--sg-border-subtle)] px-3 py-3">
          <p class="mb-2 text-[10px] font-semibold uppercase tracking-wider text-[var(--sg-text-faint)]">New worktree</p>

          <label for="source-ref" class="mb-0.5 block text-[10px] text-[var(--sg-text-faint)]">Source ref</label>
          <div>
            <Autocomplete
              items={refItems}
              bind:value={selectedRef}
              placeholder="Type to search branches…"
              id="source-ref"
              onselect={() => (formTouched.ref = true)}
            />
          </div>
          {#if formTouched.ref && refError}
            <p class="mt-0.5 text-[10px] text-[var(--sg-danger)]">{refError}</p>
          {/if}
          <div class="mb-2"></div>

          <label for="new-branch" class="mb-0.5 block text-[10px] text-[var(--sg-text-faint)]">New branch</label>
          <input
            id="new-branch"
            bind:value={newBranch}
            oninput={() => (formTouched.branch = true)}
            class="w-full rounded border bg-[var(--sg-input-bg)] px-2 py-1 text-xs text-[var(--sg-text)] placeholder-[var(--sg-text-faint)] outline-none {formTouched.branch && branchError ? 'border-[var(--sg-danger)] focus:border-[var(--sg-danger)]' : 'border-[var(--sg-input-border)] focus:border-[var(--sg-input-focus)]'}"
            placeholder="feature/my-task"
          />
          {#if formTouched.branch && branchError}
            <p class="mt-0.5 text-[10px] text-[var(--sg-danger)]">{branchError}</p>
          {/if}
          <div class="mb-2"></div>

          <button
            type="submit"
            disabled={creating || !formValid}
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
            <p class="text-[10px] font-semibold uppercase tracking-wider text-[var(--sg-text-faint)]">Worktrees</p>
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
          <div class="flex-1 overflow-auto px-2">
            {#if nonRootWorktrees.length === 0}
              <p class="px-1 text-xs text-[var(--sg-text-faint)]">No managed worktrees yet.</p>
            {:else}
              {#each nonRootWorktrees as wt}
                <!-- svelte-ignore a11y_no_static_element_interactions -->
                <div
                  class="group mb-0.5 flex w-full items-center gap-2 rounded px-2 py-1.5 text-left text-xs {activeWorktreePath === wt.path ? 'bg-[var(--sg-surface-raised)] text-[var(--sg-primary)]' : 'text-[var(--sg-text-dim)] hover:bg-[var(--sg-surface-raised)]'}"
                  oncontextmenu={(e) => handleWorktreeContextMenu(wt, e)}
                >
                  <button
                    class="flex min-w-0 flex-1 items-center gap-2"
                    onclick={() => {
                      activeWorktreePath = activeWorktreePath === wt.path ? null : wt.path;
                    }}
                  >
                    <span class="h-1.5 w-1.5 shrink-0 rounded-full {activeWorktreePath === wt.path ? 'bg-[var(--sg-primary)]' : 'bg-[var(--sg-border)]'}"></span>
                    <span class="truncate">{wt.branch ?? (wt.detached ? "detached" : "unknown")}</span>
                  </button>
                  <div class="flex shrink-0 items-center gap-0.5 opacity-0 group-hover:opacity-100">
                    <button
                      onclick={(event) => openRunHookMenu(wt, event.currentTarget as HTMLElement)}
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
        {#if selectedWorktree && activeWorktreePath !== workspace?.rootPath}
          <div class="border-t border-[var(--sg-border-subtle)] px-3 py-2" style="animation: sg-fade-in 0.15s ease-out">
            <p class="mb-1 text-[10px] font-semibold uppercase tracking-wider text-[var(--sg-text-faint)]">
              Worktree actions
            </p>
            <div class="mb-1.5 rounded border border-[var(--sg-border-subtle)] bg-[var(--sg-surface)] px-2 py-1">
              <span class="text-[9px] text-[var(--sg-text-faint)]">Branch</span>
              <p class="truncate font-mono text-[11px] font-medium text-[var(--sg-text)]">{selectedWorktree.branch ?? "detached HEAD"}</p>
              {#if selectedWorktree.head}
                <span class="font-mono text-[9px] text-[var(--sg-text-faint)]">{selectedWorktree.head.slice(0, 8)}</span>
              {/if}
            </div>
            <label for="action-ref" class="mb-0.5 block text-[10px] text-[var(--sg-text-faint)]">Target ref</label>
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
                onclick={() => { if (selectedWorktree && actionRef) handleCheckoutWorktree(selectedWorktree, actionRef); }}
                disabled={!actionRef}
                class="flex-1 rounded bg-[var(--sg-primary)] px-2 py-1 text-[10px] font-semibold text-[var(--sg-bg)] hover:bg-[var(--sg-primary-hover)] disabled:cursor-not-allowed disabled:opacity-40"
                title="Checkout: switch this worktree to the target ref (auto-stashes uncommitted changes)"
              >
                Checkout
              </button>
              <button
                onclick={() => { if (selectedWorktree && actionRef) handleResetWorktree(selectedWorktree, actionRef, "mixed"); }}
                disabled={!actionRef}
                class="rounded border border-[var(--sg-border)] px-2 py-1 text-[10px] text-[var(--sg-text-dim)] hover:bg-[var(--sg-surface-raised)] hover:text-[var(--sg-text)] disabled:cursor-not-allowed disabled:opacity-40"
                title="Reset --mixed: move branch pointer to target ref, keep changes as unstaged"
              >
                Reset
              </button>
              <button
                onclick={() => { if (selectedWorktree && actionRef) handleResetWorktree(selectedWorktree, actionRef, "hard"); }}
                disabled={!actionRef}
                class="rounded border border-[var(--sg-danger)]/30 px-2 py-1 text-[10px] text-[var(--sg-danger)] hover:bg-[var(--sg-danger)]/10 disabled:cursor-not-allowed disabled:opacity-40"
                title="Reset --hard: move branch pointer to target ref and DISCARD all changes"
              >
                Hard reset
              </button>
            </div>
            <p class="mt-1 text-[9px] text-[var(--sg-text-faint)]">Right-click a commit in the graph for quick actions</p>
          </div>
        {/if}
      </aside>

      <!-- Main content area -->
      <section class="flex min-w-0 flex-1 flex-col overflow-hidden">
        <!-- Commit graph -->
        <div class="flex min-h-0 overflow-hidden {selectedCommits.length > 0 ? 'h-1/2' : 'flex-1'} flex-col">
          <div class="flex items-center justify-between border-b border-[var(--sg-border-subtle)] bg-[var(--sg-surface)] px-4 py-2">
            <div class="flex items-center gap-2">
              <p class="text-[10px] font-semibold uppercase tracking-wider text-[var(--sg-text-faint)]">Commit graph</p>
              {#if selectedCommits.length > 0}
                <span class="text-[10px] text-[var(--sg-primary)]">
                  {selectedCommits.length === 1 ? "1 commit selected" : `${selectedCommits.length} commits selected`}
                </span>
              {/if}
            </div>
            <span class="text-[10px] text-[var(--sg-text-faint)]">{graph?.commits.length ?? 0} commits</span>
          </div>

          <div class="flex flex-1 flex-col overflow-hidden bg-[var(--sg-bg)]">
            {#if loading}
              <div class="flex flex-1 items-center justify-center gap-2" style="animation: sg-fade-in 0.3s ease-out">
                <Spinner size="md" />
                <p class="text-xs text-[var(--sg-text-faint)]">Loading commit history…</p>
              </div>
            {:else}
              <CommitGraph
                commits={graph?.commits ?? []}
                worktrees={worktrees}
                activeWorktree={selectedWorktree && activeWorktreePath !== workspace?.rootPath ? selectedWorktree : null}
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
          <div class="flex min-h-0 flex-1 flex-col border-t border-[var(--sg-border)]" style="animation: sg-slide-up 0.15s ease-out">
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
  <div class="fixed inset-0 z-[90] flex items-center justify-center p-4" style="animation: sg-fade-in 0.2s ease-out">
    <div class="w-[min(940px,98vw)] rounded-xl border border-[var(--sg-border)] bg-[var(--sg-surface)] px-4 py-4 shadow-xl">
      <div class="flex items-center gap-3">
        <Spinner size="md" />
        <div>
          <p class="text-sm font-semibold text-[var(--sg-text)]">{operationStatus.title}</p>
          <p class="mt-0.5 text-xs text-[var(--sg-text-dim)]">{operationStatus.detail}</p>
        </div>
      </div>
      {#if activeHookName}
        <p class="mt-3 text-xs text-[var(--sg-primary)]">Running hook: {activeHookName}</p>
      {/if}
      {#if operationError}
        <div class="mt-3 rounded border border-[var(--sg-danger)]/35 bg-[var(--sg-danger)]/10 px-3 py-2">
          <p class="text-xs font-medium text-[var(--sg-danger)]">Operation failed</p>
          <p class="mt-0.5 text-[11px] text-[var(--sg-text-dim)]">{operationError}</p>
        </div>
      {/if}
      <div class="mt-3 grid gap-3 lg:grid-cols-[1.2fr,1fr]">
        <div class="max-h-[340px] overflow-auto rounded border border-[var(--sg-border-subtle)] bg-[var(--sg-surface-raised)] p-2.5">
          <div class="mb-2 flex flex-wrap items-center gap-1.5 text-[10px]">
            <span class="rounded border border-[var(--sg-border)] bg-[var(--sg-surface)] px-1.5 py-px text-[var(--sg-text-faint)]">Pending: {hookStatusSummary.pending}</span>
            <span class="rounded border border-[var(--sg-accent)]/40 bg-[var(--sg-accent)]/15 px-1.5 py-px text-[var(--sg-accent)]">Running: {hookStatusSummary.running}</span>
            <span class="rounded border border-[var(--sg-primary)]/40 bg-[var(--sg-primary)]/15 px-1.5 py-px text-[var(--sg-primary)]">Complete: {hookStatusSummary.success}</span>
            <span class="rounded border border-[var(--sg-warning)]/40 bg-[var(--sg-warning)]/15 px-1.5 py-px text-[var(--sg-warning)]">Skipped: {hookStatusSummary.skipped}</span>
            <span class="rounded border border-[var(--sg-danger)]/40 bg-[var(--sg-danger)]/15 px-1.5 py-px text-[var(--sg-danger)]">Errors: {hookStatusSummary.error + hookStatusSummary.timed_out}</span>
          </div>
          {#if operationHooks.length === 0}
            <p class="text-[10px] text-[var(--sg-text-faint)]">No hooks registered for this operation.</p>
          {:else}
            <div class="space-y-2">
              {#each operationHooks as hook (hook.id)}
                <div class="rounded border border-[var(--sg-border)] bg-[var(--sg-surface)] p-2">
                  <div class="flex items-start justify-between gap-2">
                    <div class="min-w-0">
                      <p class="truncate text-xs font-medium text-[var(--sg-text)]">{hook.name}</p>
                      <p class="mt-0.5 text-[10px] text-[var(--sg-text-faint)]">{hook.trigger}</p>
                    </div>
                    <span class={`shrink-0 rounded border px-1.5 py-px text-[10px] ${statusBadgeClass(hook.status)}`}>
                      {statusLabel(hook.status)}
                    </span>
                  </div>
                  <div class="mt-1.5 max-h-24 overflow-auto rounded border border-[var(--sg-border-subtle)] bg-[var(--sg-bg)] p-1.5">
                    {#if hook.logs.length === 0}
                      <p class="text-[10px] text-[var(--sg-text-faint)]">Waiting for output...</p>
                    {:else}
                      <pre class="whitespace-pre-wrap break-words font-mono text-[10px] leading-relaxed text-[var(--sg-text-dim)]">{hook.logs.join("\n\n")}</pre>
                    {/if}
                  </div>
                </div>
              {/each}
            </div>
          {/if}
        </div>

        <div class="max-h-[340px] overflow-auto rounded border border-[var(--sg-border-subtle)] bg-[var(--sg-surface-raised)] p-2.5">
          <p class="mb-1 text-[10px] font-semibold uppercase tracking-wider text-[var(--sg-text-faint)]">Operation Timeline</p>
          {#if operationLogs.length === 0}
            <p class="text-[10px] text-[var(--sg-text-faint)]">Waiting for hook output...</p>
          {:else}
            <pre class="whitespace-pre-wrap break-words font-mono text-[10px] leading-relaxed text-[var(--sg-text-dim)]">{operationLogs.join("\n")}</pre>
          {/if}
        </div>
      </div>
      {#if operationError}
        <div class="mt-3 flex justify-end">
          <button
            onclick={() => endOperation(true)}
            class="rounded border border-[var(--sg-border)] px-2.5 py-1 text-xs text-[var(--sg-text-dim)] hover:bg-[var(--sg-surface-raised)] hover:text-[var(--sg-text)]"
          >
            Dismiss
          </button>
        </div>
      {:else}
        <p class="mt-3 text-[10px] text-[var(--sg-text-faint)]">Please wait. This can include lifecycle hooks and git operations.</p>
      {/if}
    </div>
  </div>
{/if}

<WorkspaceHooksModal
  open={hooksModalOpen}
  workspacePath={workspace?.workspacePath ?? ""}
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
