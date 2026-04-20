<script lang="ts">
  import { goto } from "$app/navigation";
  import { page } from "$app/stores";
  import Autocomplete from "$lib/components/Autocomplete.svelte";
  import CommitGraph from "$lib/components/CommitGraph.svelte";
  import ConfirmDialog from "$lib/components/ConfirmDialog.svelte";
  import ContextMenu, { type MenuItem } from "$lib/components/ContextMenu.svelte";
  import DiffViewer from "$lib/components/DiffViewer.svelte";
  import Spinner from "$lib/components/Spinner.svelte";
  import {
    checkoutWorktree,
    createManagedWorktree,
    deleteManagedWorktree,
    getCommitGraph,
    getDiffContent,
    getDiffFiles,
    inspectWorkspace,
    listRefs,
    listWorktrees,
    openInEditor,
    resetWorktreeBranch,
    type CommitEntry,
    type CommitGraphResult,
    type DiffFileEntry,
    type RefInfo,
    type WorkspaceStatus,
    type WorktreeInfo,
  } from "$lib/sproutgit";
  import { toast } from "$lib/toast.svelte";
  import { validateBranchName, validateSourceRef } from "$lib/validation";
  import { openPath } from "@tauri-apps/plugin-opener";
  import { FolderOpen, Trash2, SquareTerminal, ShieldAlert } from "lucide-svelte";
  import WindowControls from "$lib/components/WindowControls.svelte";

  let workspace = $state<WorkspaceStatus | null>(null);
  let worktrees = $state<WorktreeInfo[]>([]);
  let graph = $state<CommitGraphResult | null>(null);
  let refs = $state<RefInfo[]>([]);
  let selectedRef = $state("");
  let newBranch = $state("");
  let activeWorktreePath = $state<string | null>(null);
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
        getCommitGraph(status.rootPath, 140),
      ]);

      worktrees = worktreeData.worktrees;
      refs = refsData.refs;
      graph = graphData;
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
      toast.error(String(err));
      error = String(err);
    } finally {
      creating = false;
    }
  }

  loadWorkspace();

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
          toast.error(String(err));
        } finally {
          deleting = null;
        }
      },
    };
  }

  async function refreshWorkspaceData() {
    if (!workspace) return;
    const [refreshedWt, refreshedGraph, refreshedRefs] = await Promise.all([
      listWorktrees(workspace.rootPath),
      getCommitGraph(workspace.rootPath, 140),
      listRefs(workspace.rootPath),
    ]);
    worktrees = refreshedWt.worktrees;
    graph = refreshedGraph;
    refs = refreshedRefs.refs;
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
          const result = await checkoutWorktree(wt.path, targetRef, true);
          if (result.stashed) {
            toast.warning(`Checked out ${result.newBranch} — changes were stashed (may need manual resolve)`);
          } else {
            toast.success(`Checked out ${result.newBranch}`);
          }
          await refreshWorkspaceData();
        } catch (err) {
          toast.error(String(err));
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
          await resetWorktreeBranch(wt.path, targetRef, mode);
          toast.success(`Reset ${label} to ${targetRef} (${mode})`);
          await refreshWorkspaceData();
        } catch (err) {
          toast.error(String(err));
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
        onclick={() => goto("/settings")}
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
          <div class="px-3 py-2">
            <p class="text-[10px] font-semibold uppercase tracking-wider text-[var(--sg-text-faint)]">Worktrees</p>
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
      <section class="flex min-w-0 flex-1 flex-col">
        <!-- Commit graph -->
        <div class="flex min-h-0 {selectedCommits.length > 0 ? 'h-1/2' : 'flex-1'} flex-col">
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

{#if worktreeContextMenu}
  <ContextMenu
    items={worktreeContextMenu.items}
    x={worktreeContextMenu.x}
    y={worktreeContextMenu.y}
    onclose={() => (worktreeContextMenu = null)}
  />
{/if}
