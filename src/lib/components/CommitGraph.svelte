<script lang="ts">
  import type { CommitEntry, WorktreeInfo } from "$lib/sproutgit";
  import ContextMenu, { type MenuItem } from "$lib/components/ContextMenu.svelte";
  import { toast } from "$lib/toast.svelte";
  import { onDestroy, onMount } from "svelte";
  import { Search, ChevronUp, ChevronDown, X, GitBranch } from "lucide-svelte";

  type Props = {
    commits: CommitEntry[];
    worktrees?: WorktreeInfo[];
    activeWorktree?: WorktreeInfo | null;
    oncreateworktree?: (fromRef: string) => void;
    oncheckout?: (targetRef: string) => void;
    onreset?: (targetRef: string, mode: "soft" | "mixed" | "hard") => void;
    onselect?: (commits: CommitEntry[]) => void;
    hasmore?: boolean;
    loadingmore?: boolean;
    onloadmore?: () => void;
  };

  const {
    commits,
    worktrees = [],
    activeWorktree = null,
    oncreateworktree,
    oncheckout,
    onreset,
    onselect,
    hasmore = false,
    loadingmore = false,
    onloadmore,
  }: Props = $props();

  const ROW_H = 28;
  const COL_W = 16;
  const NODE_R = 4;
  const PADDING_LEFT = 8;

  // Lane colors — cycle through these for different branches
  const LANE_COLORS = [
    "var(--sg-primary)",
    "var(--sg-accent)",
    "#e879a0",
    "#fab387",
    "#a6e3a1",
    "#cba6f7",
    "#f9e2af",
    "#89dceb",
    "#f5c2e7",
    "#94e2d5",
  ];

  // ── Worktree branch set ──
  const worktreeBranches = $derived(
    new Set(worktrees.filter((w) => w.branch).map((w) => w.branch!)),
  );

  const branchToWorktreePath = $derived(
    new Map(worktrees.filter((w) => w.branch).map((w) => [w.branch!, w.path])),
  );

  // ── Search state ──
  let searchOpen = $state(false);
  let searchQuery = $state("");
  let activeMatchIdx = $state(0);
  let searchInput = $state<HTMLInputElement | null>(null);
  let scrollContainer = $state<HTMLDivElement | null>(null);

  // Track scroll position and visible height for sticky SVG column
  let graphScrollTop = $state(0);
  let pendingGraphScrollTop = 0;
  let graphScrollRaf = 0;
  let containerHeight = $state(0);

  $effect(() => {
    if (!scrollContainer) return;
    containerHeight = scrollContainer.clientHeight;
    const ro = new ResizeObserver(() => {
      containerHeight = scrollContainer!.clientHeight;
    });
    ro.observe(scrollContainer);
    return () => ro.disconnect();
  });

  // ── Context menu state ──
  let contextMenu = $state<{ x: number; y: number; items: MenuItem[] } | null>(null);

  // ── Selection state ──
  let selectedIndices = $state<Set<number>>(new Set());
  let lastClickedIdx = $state<number | null>(null);

  const selectedSet = $derived(selectedIndices);

  function updateCommitSelection(
    idx: number,
    modifiers: { shiftKey: boolean; metaKey: boolean; ctrlKey: boolean },
  ) {
    if (modifiers.shiftKey && lastClickedIdx !== null) {
      // Range select from last clicked to current
      const start = Math.min(lastClickedIdx, idx);
      const end = Math.max(lastClickedIdx, idx);
      const newSet = new Set<number>();
      for (let i = start; i <= end; i++) {
        newSet.add(i);
      }
      selectedIndices = newSet;
    } else if (modifiers.metaKey || modifiers.ctrlKey) {
      // Toggle individual
      const newSet = new Set(selectedIndices);
      if (newSet.has(idx)) {
        newSet.delete(idx);
      } else {
        newSet.add(idx);
      }
      selectedIndices = newSet;
      lastClickedIdx = idx;
    } else {
      // Single select (toggle off if already only selection)
      if (selectedIndices.size === 1 && selectedIndices.has(idx)) {
        selectedIndices = new Set();
        lastClickedIdx = null;
      } else {
        selectedIndices = new Set([idx]);
        lastClickedIdx = idx;
      }
    }

    // Emit selected commits
    if (onselect) {
      const selected = [...selectedIndices]
        .sort((a, b) => a - b)
        .map((i) => laneData.rows[i])
        .filter(Boolean);
      onselect(selected);
    }
  }

  function handleCommitClick(idx: number, e: MouseEvent) {
    updateCommitSelection(idx, {
      shiftKey: e.shiftKey,
      metaKey: e.metaKey,
      ctrlKey: e.ctrlKey,
    });
  }

  function handleCommitKeydown(idx: number, e: KeyboardEvent) {
    if (e.key !== "Enter" && e.key !== " ") {
      return;
    }

    e.preventDefault();
    updateCommitSelection(idx, {
      shiftKey: e.shiftKey,
      metaKey: e.metaKey,
      ctrlKey: e.ctrlKey,
    });
  }

  // Derive the active worktree label for context menus
  const activeWtLabel = $derived(
    activeWorktree?.branch ?? activeWorktree?.path.split("/").pop() ?? null,
  );

  const matchingIndices = $derived.by(() => {
    if (!searchQuery.trim()) return [] as number[];
    const q = searchQuery.toLowerCase();
    const indices: number[] = [];
    for (let i = 0; i < laneData.rows.length; i++) {
      const row = laneData.rows[i];
      if (
        row.subject.toLowerCase().includes(q) ||
        row.shortHash.toLowerCase().includes(q) ||
        row.hash.toLowerCase().includes(q)
      ) {
        indices.push(i);
      }
    }
    return indices;
  });

  const matchSet = $derived(new Set(matchingIndices));

  function openSearch() {
    searchOpen = true;
    activeMatchIdx = 0;
    // Focus input after DOM update
    requestAnimationFrame(() => searchInput?.focus());
  }

  function closeSearch() {
    searchOpen = false;
    searchQuery = "";
    activeMatchIdx = 0;
  }

  function scrollToMatch(matchIdx: number) {
    if (!scrollContainer || matchingIndices.length === 0) return;
    const rowIdx = matchingIndices[matchIdx];
    if (rowIdx == null) return;
    const targetY = rowIdx * ROW_H - scrollContainer.clientHeight / 2 + ROW_H / 2;
    scrollContainer.scrollTo({ top: Math.max(0, targetY), behavior: "smooth" });
  }

  function handleGraphScroll() {
    if (!scrollContainer) return;
    pendingGraphScrollTop = scrollContainer.scrollTop;
    if (!graphScrollRaf) {
      graphScrollRaf = requestAnimationFrame(() => {
        graphScrollTop = pendingGraphScrollTop;
        graphScrollRaf = 0;
      });
    }

    if (!hasmore || loadingmore || !onloadmore) return;
    const remaining =
      scrollContainer.scrollHeight - (scrollContainer.scrollTop + scrollContainer.clientHeight);
    if (remaining <= ROW_H * 12) {
      onloadmore();
    }
  }

  onDestroy(() => {
    if (graphScrollRaf) {
      cancelAnimationFrame(graphScrollRaf);
      graphScrollRaf = 0;
    }
  });

  function nextMatch() {
    if (matchingIndices.length === 0) return;
    activeMatchIdx = (activeMatchIdx + 1) % matchingIndices.length;
    scrollToMatch(activeMatchIdx);
  }

  function prevMatch() {
    if (matchingIndices.length === 0) return;
    activeMatchIdx = (activeMatchIdx - 1 + matchingIndices.length) % matchingIndices.length;
    scrollToMatch(activeMatchIdx);
  }

  function handleSearchKeydown(e: KeyboardEvent) {
    if (e.key === "Escape") {
      closeSearch();
    } else if (e.key === "Enter") {
      if (e.shiftKey) prevMatch();
      else nextMatch();
    }
  }

  // Scroll to first match when query changes
  $effect(() => {
    if (matchingIndices.length > 0) {
      activeMatchIdx = 0;
      scrollToMatch(0);
    }
  });

  onMount(() => {
    function handleKeydown(e: KeyboardEvent) {
      if ((e.metaKey || e.ctrlKey) && e.key === "f") {
        e.preventDefault();
        openSearch();
      }
    }
    window.addEventListener("keydown", handleKeydown);
    return () => window.removeEventListener("keydown", handleKeydown);
  });

  // ── Context menu builders ──
  function copyToClipboard(text: string, label: string) {
    navigator.clipboard.writeText(text);
    toast.success(`Copied ${label}`);
  }

  function handleRefClick(ref: string, e: MouseEvent) {
    e.stopPropagation();
    const cleanRef = ref.startsWith("tag: ") ? ref.replace("tag: ", "") : ref;
    copyToClipboard(cleanRef, cleanRef);
  }

  function handleRefKeydown(ref: string, e: KeyboardEvent) {
    if (e.key !== "Enter" && e.key !== " ") {
      return;
    }

    e.preventDefault();
    e.stopPropagation();
    const cleanRef = ref.startsWith("tag: ") ? ref.replace("tag: ", "") : ref;
    copyToClipboard(cleanRef, cleanRef);
  }

  function commitContextMenu(row: LaneCommit, e: MouseEvent) {
    e.preventDefault();
    const items: MenuItem[] = [
      { label: "Copy full hash", action: () => copyToClipboard(row.hash, "hash") },
      { label: "Copy short hash", action: () => copyToClipboard(row.shortHash, "hash") },
      { label: "Copy commit message", action: () => copyToClipboard(row.subject, "message") },
      { separator: true },
    ];

    for (const ref of row.refs) {
      if (ref === "HEAD") continue;
      if (ref.startsWith("tag:")) {
        items.push({ label: `Copy tag: ${ref.replace("tag: ", "")}`, action: () => copyToClipboard(ref.replace("tag: ", ""), "tag") });
      } else {
        items.push({ label: `Copy branch: ${ref}`, action: () => copyToClipboard(ref, "branch") });
      }
    }

    const wtBranches = row.refs.filter((r) => worktreeBranches.has(r));
    if (wtBranches.length > 0) {
      items.push({ separator: true });
      for (const b of wtBranches) {
        const wtPath = branchToWorktreePath.get(b);
        if (wtPath) {
          items.push({ label: `Copy worktree path: ${b}`, action: () => copyToClipboard(wtPath, "worktree path") });
        }
      }
    }

    // Checkout/reset actions for the active worktree
    if (activeWtLabel && (oncheckout || onreset)) {
      items.push({ separator: true });
      const targetRef = row.refs.find((r) => r !== "HEAD" && !r.startsWith("tag:")) ?? row.refs.find((r) => r !== "HEAD") ?? row.shortHash;
      if (oncheckout) {
        items.push({
          label: `Checkout "${activeWtLabel}" → ${targetRef}`,
          icon: "⎋",
          action: () => oncheckout(targetRef === row.shortHash ? row.hash : targetRef),
        });
      }
      if (onreset) {
        items.push({
          label: `Reset "${activeWtLabel}" → ${targetRef} (mixed)`,
          icon: "↺",
          action: () => onreset(targetRef === row.shortHash ? row.hash : targetRef, "mixed"),
        });
        items.push({
          label: `Reset "${activeWtLabel}" → ${targetRef} (hard)`,
          icon: "↺",
          danger: true,
          action: () => onreset(targetRef === row.shortHash ? row.hash : targetRef, "hard"),
        });
      }
    }

    if (oncreateworktree) {
      items.push({ separator: true });
      // Prefer branch/tag refs, fall back to commit hash
      const nonHeadRefs = row.refs.filter((r) => r !== "HEAD");
      if (nonHeadRefs.length > 0) {
        for (const ref of nonHeadRefs) {
          const label = ref.startsWith("tag: ") ? ref.replace("tag: ", "") : ref;
          items.push({ label: `Create worktree from ${label}`, icon: "🌿", action: () => oncreateworktree(label) });
        }
      } else {
        items.push({ label: `Create worktree from ${row.shortHash}`, icon: "🌿", action: () => oncreateworktree(row.hash) });
      }
    }

    contextMenu = { x: e.clientX, y: e.clientY, items };
  }

  function refContextMenu(ref: string, e: MouseEvent) {
    e.preventDefault();
    e.stopPropagation();
    const items: MenuItem[] = [
      { label: `Copy: ${ref}`, action: () => copyToClipboard(ref, "ref") },
    ];
    const wtPath = branchToWorktreePath.get(ref);
    if (wtPath) {
      items.push({ separator: true });
      items.push({ label: "Copy worktree path", action: () => copyToClipboard(wtPath, "worktree path") });
    }

    // Checkout/reset to this ref from the active worktree
    if (activeWtLabel && ref !== "HEAD") {
      const cleanRef = ref.startsWith("tag: ") ? ref.replace("tag: ", "") : ref;
      if (oncheckout) {
        items.push({ separator: true });
        items.push({
          label: `Checkout "${activeWtLabel}" → ${cleanRef}`,
          icon: "⎋",
          action: () => oncheckout(cleanRef),
        });
      }
      if (onreset) {
        if (!oncheckout) items.push({ separator: true });
        items.push({
          label: `Reset "${activeWtLabel}" → ${cleanRef}`,
          icon: "↺",
          action: () => onreset(cleanRef, "mixed"),
        });
      }
    }

    if (oncreateworktree) {
      items.push({ separator: true });
      const label = ref.startsWith("tag: ") ? ref.replace("tag: ", "") : ref;
      items.push({ label: `Create worktree from ${label}`, icon: "🌿", action: () => oncreateworktree(label) });
    }
    contextMenu = { x: e.clientX, y: e.clientY, items };
  }

  type LaneCommit = CommitEntry & {
    lane: number;
    y: number;
    parentPositions: { hash: string; lane: number; y: number }[];
    offGraphParentCount: number;
    worktreeBranch: string | null;
  };

  // Compute lane assignments using a simple column-allocation algorithm
  const laneData = $derived.by(() => {
    if (commits.length === 0) return { rows: [] as LaneCommit[], maxLane: 0 };

    // Map from hash to row index
    const hashToIdx = new Map<string, number>();
    commits.forEach((c, i) => hashToIdx.set(c.hash, i));

    // Active lanes: each slot holds the hash of the commit that "owns" that lane, or null
    const activeLanes: (string | null)[] = [];

    function findOrAllocLane(hash: string): number {
      // Check if this hash already has a reserved lane
      const existing = activeLanes.indexOf(hash);
      if (existing !== -1) return existing;

      // Find first empty lane
      const empty = activeLanes.indexOf(null);
      if (empty !== -1) {
        activeLanes[empty] = hash;
        return empty;
      }

      // Allocate new lane
      activeLanes.push(hash);
      return activeLanes.length - 1;
    }

    const rows: LaneCommit[] = [];
    let maxLane = 0;

    for (let i = 0; i < commits.length; i++) {
      const commit = commits[i];
      const lane = findOrAllocLane(commit.hash);
      if (lane > maxLane) maxLane = lane;

      const y = i * ROW_H + ROW_H / 2;

      // Free current lane
      activeLanes[lane] = null;

      // Reserve lanes for parents (first parent takes current lane)
      for (let p = 0; p < commit.parents.length; p++) {
        const parentHash = commit.parents[p];
        // Only reserve if parent is in our visible set and not already assigned
        if (hashToIdx.has(parentHash) && activeLanes.indexOf(parentHash) === -1) {
          if (p === 0) {
            // First parent continues in same lane
            activeLanes[lane] = parentHash;
          } else {
            const pLane = findOrAllocLane(parentHash);
            if (pLane > maxLane) maxLane = pLane;
          }
        }
      }

      // Determine if any ref on this commit is an active worktree branch
      const wtBranch = commit.refs.find((r) => worktreeBranches.has(r)) ?? null;

      rows.push({
        ...commit,
        lane,
        y,
        parentPositions: [],
        offGraphParentCount: 0,
        worktreeBranch: wtBranch,
      });
    }

    // Second pass: resolve parent positions for line drawing
    const hashToRow = new Map<string, LaneCommit>();
    rows.forEach((r) => hashToRow.set(r.hash, r));

    for (const row of rows) {
      row.parentPositions = row.parents
        .map((ph) => {
          const parent = hashToRow.get(ph);
          if (!parent) return null;
          return { hash: ph, lane: parent.lane, y: parent.y };
        })
        .filter((p): p is NonNullable<typeof p> => p !== null);

      row.offGraphParentCount = row.parents.length - row.parentPositions.length;
    }

    return { rows, maxLane };
  });

  const svgWidth = $derived((laneData.maxLane + 1) * COL_W + PADDING_LEFT * 2);
  const svgHeight = $derived(commits.length * ROW_H);

  function laneX(lane: number): number {
    return PADDING_LEFT + lane * COL_W + COL_W / 2;
  }

  function laneColor(lane: number): string {
    return LANE_COLORS[lane % LANE_COLORS.length];
  }

  function refBadgeClass(ref: string): string {
    if (ref.startsWith("tag:")) return "bg-[var(--sg-warning)]/20 text-[var(--sg-warning)]";
    if (ref === "HEAD") return "bg-[var(--sg-danger)]/20 text-[var(--sg-danger)]";
    if (worktreeBranches.has(ref)) return "bg-[var(--sg-accent)]/20 text-[var(--sg-accent)]";
    return "bg-[var(--sg-primary)]/20 text-[var(--sg-primary)]";
  }
</script>

{#if laneData.rows.length === 0}
  <div class="flex h-full items-center justify-center text-sm text-[var(--sg-text-faint)]">
    No commits yet.
  </div>
{:else}
  <div class="relative flex h-full min-h-0 flex-1 flex-col overflow-hidden">
    <!-- Search bar -->
    {#if searchOpen}
      <div class="flex shrink-0 items-center gap-2 border-b border-[var(--sg-border-subtle)] bg-[var(--sg-surface)] px-3 py-1.5" style="animation: sg-slide-down 0.15s ease-out">
        <Search class="h-3.5 w-3.5 shrink-0 text-[var(--sg-text-faint)]" />
        <input
          bind:this={searchInput}
          bind:value={searchQuery}
          onkeydown={handleSearchKeydown}
          class="min-w-0 flex-1 bg-transparent text-xs text-[var(--sg-text)] placeholder-[var(--sg-text-faint)] outline-none"
          placeholder="Search commits by message or hash…"
        />
        {#if searchQuery.trim()}
          <span class="shrink-0 text-[10px] text-[var(--sg-text-faint)]">
            {matchingIndices.length > 0
              ? `${activeMatchIdx + 1}/${matchingIndices.length}`
              : "No matches"}
          </span>
          <button onclick={prevMatch} class="rounded p-0.5 text-[var(--sg-text-faint)] hover:bg-[var(--sg-surface-raised)] hover:text-[var(--sg-text)]" title="Previous (Shift+Enter)">
            <ChevronUp class="h-3.5 w-3.5" />
          </button>
          <button onclick={nextMatch} class="rounded p-0.5 text-[var(--sg-text-faint)] hover:bg-[var(--sg-surface-raised)] hover:text-[var(--sg-text)]" title="Next (Enter)">
            <ChevronDown class="h-3.5 w-3.5" />
          </button>
        {/if}
        <button onclick={closeSearch} class="rounded p-0.5 text-[var(--sg-text-faint)] hover:bg-[var(--sg-surface-raised)] hover:text-[var(--sg-text)]" title="Close (Esc)">
          <X class="h-3.5 w-3.5" />
        </button>
      </div>
    {/if}

    <!-- Scrollable graph area -->
    <div bind:this={scrollContainer} onscroll={handleGraphScroll} class="min-h-0 flex-1 overflow-y-auto overflow-x-hidden">
      <div class="flex">
      <!-- SVG graph lanes — sticky so horizontal scrollbar stays in viewport -->
      <div
        class="sg-scrollbar-visible sticky top-0 shrink-0 self-start overflow-y-hidden"
        style="max-width: min({svgWidth}px, 120px); height: {containerHeight}px"
      >
        <svg width={svgWidth} height={svgHeight} class="block" style="transform: translateY(-{graphScrollTop}px)">
          <!-- Connection lines -->
          {#each laneData.rows as row}
            {#each row.parentPositions as parent}
              {#if row.lane === parent.lane}
                <line
                  x1={laneX(row.lane)}
                  y1={row.y}
                  x2={laneX(parent.lane)}
                  y2={parent.y}
                  stroke={laneColor(row.lane)}
                  stroke-width="2"
                  opacity="0.7"
                />
              {:else}
                {@const x1 = laneX(row.lane)}
                {@const x2 = laneX(parent.lane)}
                {@const dy = Math.max(ROW_H, parent.y - row.y)}
                {@const c = Math.max(ROW_H * 0.6, Math.min(dy * 0.3, ROW_H * 3))}
                <path
                  d="M {x1} {row.y}
                     C {x1} {row.y + c},
                       {x2} {parent.y - c},
                       {x2} {parent.y}"
                  fill="none"
                  stroke={laneColor(parent.lane)}
                  stroke-width="2"
                  opacity="0.5"
                />
              {/if}
            {/each}

            {#if row.offGraphParentCount > 0}
              {@const x = laneX(row.lane)}
              {@const x2 = x + COL_W * 0.75}
              {@const y2 = Math.min(svgHeight - 2, row.y + ROW_H * 0.9)}
              <line
                x1={x}
                y1={row.y}
                x2={x2}
                y2={y2}
                stroke={laneColor(row.lane)}
                stroke-width="2"
                stroke-dasharray="3 3"
                opacity="0.55"
              />
            {/if}
          {/each}

          <!-- Commit nodes -->
          {#each laneData.rows as row, i}
            {#if row.worktreeBranch}
              <!-- Worktree commit: diamond shape -->
              <g transform="translate({laneX(row.lane)}, {row.y}) rotate(45)">
                <rect
                  x={-NODE_R}
                  y={-NODE_R}
                  width={NODE_R * 2}
                  height={NODE_R * 2}
                  fill={matchSet.size > 0 && !matchSet.has(i) ? "var(--sg-text-faint)" : laneColor(row.lane)}
                  opacity={matchSet.size > 0 && !matchSet.has(i) ? 0.3 : 1}
                  rx="1"
                />
              </g>
            {:else}
              <circle
                cx={laneX(row.lane)}
                cy={row.y}
                r={NODE_R}
                fill={matchSet.size > 0 && !matchSet.has(i) ? "var(--sg-text-faint)" : laneColor(row.lane)}
                opacity={matchSet.size > 0 && !matchSet.has(i) ? 0.3 : 1}
              />
            {/if}
          {/each}
        </svg>
      </div>

      <!-- Commit list table -->
      <div class="min-w-0 flex-1 overflow-hidden">
        {#each laneData.rows as row, i}
          {@const isMatch = matchSet.has(i)}
          {@const isActive = matchingIndices[activeMatchIdx] === i}
          {@const dimmed = matchSet.size > 0 && !isMatch}
          {@const isSelected = selectedSet.has(i)}
          {@const isWtRow = !!row.worktreeBranch}
          <div
            data-testid="commit-row"
            data-commit-hash={row.hash}
            class="flex cursor-pointer select-none items-center gap-2 border-b border-[var(--sg-border-subtle)] px-3 {dimmed ? 'opacity-30' : ''} {isSelected ? 'bg-[var(--sg-primary)]/15' : isActive ? 'bg-[var(--sg-primary)]/10' : isWtRow ? 'bg-[var(--sg-accent)]/5' : 'hover:bg-[var(--sg-surface-raised)]'}"
            style="height: {ROW_H}px"
            role="button"
            tabindex="0"
            aria-label="Select commit {row.shortHash}"
            onclick={(e) => handleCommitClick(i, e)}
            onkeydown={(e) => handleCommitKeydown(i, e)}
            oncontextmenu={(e) => commitContextMenu(row, e)}
          >
          <!-- Subject + refs -->
          <div class="min-w-0 flex-1 truncate">
            {#each row.refs as ref}
              <button
                type="button"
                class="font-code mr-1 inline-block cursor-pointer appearance-none rounded px-1 py-px text-[10px] font-medium transition-opacity hover:opacity-80 {refBadgeClass(ref)}"
                aria-label="Copy ref {ref}"
                onclick={(e) => handleRefClick(ref, e)}
                onkeydown={(e) => handleRefKeydown(ref, e)}
                oncontextmenu={(e) => refContextMenu(ref, e)}
                title="Click to copy, right-click for more"
              >
                {#if worktreeBranches.has(ref)}
                  <GitBranch class="mr-0.5 inline h-2.5 w-2.5" />
                {/if}
                {ref}
              </button>
            {/each}
            <span class="text-xs text-[var(--sg-text)]">{row.subject}</span>
          </div>

          <!-- Worktree indicator -->
          {#if row.worktreeBranch}
            <span class="shrink-0 rounded bg-[var(--sg-accent)]/15 px-1.5 py-px text-[9px] font-medium text-[var(--sg-accent)]" title="Worktree: {branchToWorktreePath.get(row.worktreeBranch) ?? ''}">
              WT
            </span>
          {/if}

          {#if row.offGraphParentCount > 0}
            <span
              class="shrink-0 rounded bg-[var(--sg-warning)]/15 px-1.5 py-px text-[9px] font-medium text-[var(--sg-warning)]"
              title="{row.offGraphParentCount} parent commit(s) are outside the loaded graph"
            >
              ↘ +{row.offGraphParentCount}
            </span>
          {/if}

          <!-- Hash -->
          <span class="shrink-0 font-mono text-[10px] text-[var(--sg-text-faint)]">{row.shortHash}</span>

          <!-- Author -->
          <span class="hidden w-24 shrink-0 truncate text-[10px] text-[var(--sg-text-faint)] sm:block">{row.authorName}</span>

          <!-- Date -->
          <span class="hidden w-20 shrink-0 text-right text-[10px] text-[var(--sg-text-faint)] md:block">{row.authorDate}</span>
        </div>
      {/each}

      {#if loadingmore}
        <div class="flex items-center justify-center border-b border-[var(--sg-border-subtle)] px-3" style="height: {ROW_H}px">
          <span class="text-[10px] text-[var(--sg-text-faint)]">Loading older commits…</span>
        </div>
      {:else if hasmore}
        <div class="flex items-center justify-center border-b border-[var(--sg-border-subtle)] px-3" style="height: {ROW_H}px">
          <span class="text-[10px] text-[var(--sg-text-faint)]">Scroll down to load older commits</span>
        </div>
      {/if}
      </div>
    </div>
  </div>
  </div>
{/if}

<!-- Context menu overlay -->
{#if contextMenu}
  <ContextMenu items={contextMenu.items} x={contextMenu.x} y={contextMenu.y} onclose={() => (contextMenu = null)} />
{/if}
