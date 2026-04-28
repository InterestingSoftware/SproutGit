<script lang="ts">
  import { tick } from 'svelte';
  import TerminalPanel from './TerminalPanel.svelte';
  import ContextMenu, { type MenuItem } from './ContextMenu.svelte';

  type Session = {
    id: string;
    shell: string;
    label: string;
    initialCommand?: string;
  };

  type TerminalLaunchRequest = {
    id: string;
    cwd: string;
    shell: string;
    label: string;
    command: string;
  };

  type Layout = 'tabs' | 'split' | 'grid';

  type Props = {
    defaultShell: string;
    availableShells: string[];
    cwd: string;
    launchRequest?: TerminalLaunchRequest | null;
  };

  const { defaultShell, availableShells, cwd, launchRequest = null }: Props = $props();

  // ── Session state ─────────────────────────────────────────────────────────
  let sessions = $state<Session[]>([]);
  let activeId = $state<string | null>(null);
  let layout = $state<Layout>('tabs');
  let showAddMenu = $state(false);
  let counter = 0;
  let lastLaunchRequestId = $state<string | null>(null);

  // Auto-spawn the first session when the component mounts and a default shell is available.
  // The plain (non-reactive) `_autoSpawned` flag ensures this runs only once even if
  // `defaultShell` later changes, and prevents a reactive loop since `sessions` is never
  // read inside this effect.
  let _autoSpawned = false;
  $effect(() => {
    if (!_autoSpawned && defaultShell) {
      _autoSpawned = true;
      addSession(defaultShell);
    }
  });

  // Panel component refs — used to forward focus() and refit().
  // Plain object (not $state) because we don't need reactivity on the refs themselves.
  const panelInstances: Partial<Record<string, { focus: () => void; refit: () => void } | null>> =
    {};
  const tabButtons: Partial<Record<string, HTMLButtonElement | null>> = {};

  // Focus the active panel whenever activeId changes.
  $effect(() => {
    const id = activeId;
    if (!id) return;
    // tick() ensures the panel is visible (display:flex) before xterm.focus() runs.
    tick().then(() => {
      panelInstances[id]?.refit(); // recalculate dimensions now that panel is visible
      panelInstances[id]?.focus();
    });
  });

  // Refit all visible panels after a layout change (split/grid reveal hidden panels).
  // Uses requestAnimationFrame (inside refit()) because xterm renders via rAF —
  // tick() alone (Svelte DOM flush) is not enough.
  $effect(() => {
    const _layout = layout; // subscribe to layout changes
    tick().then(() => {
      for (const session of sessions) {
        panelInstances[session.id]?.refit();
      }
    });
  });

  function newId() {
    return `term-${Date.now()}-${++counter}`;
  }

  function addSession(shell: string, labelOverride?: string, initialCommand?: string) {
    const count = sessions.filter(s => s.shell === shell).length;
    const fallbackLabel = count === 0 ? shell : `${shell} (${count + 1})`;
    const label = labelOverride?.trim() || fallbackLabel;
    const id = newId();
    sessions = [...sessions, { id, shell, label, initialCommand }];
    activeId = id;
    showAddMenu = false;
  }

  $effect(() => {
    if (!launchRequest || launchRequest.id === lastLaunchRequestId || launchRequest.cwd !== cwd) {
      return;
    }

    lastLaunchRequestId = launchRequest.id;
    addSession(launchRequest.shell, launchRequest.label, launchRequest.command);
  });

  function closeSession(id: string) {
    const idx = sessions.findIndex(s => s.id === id);
    sessions = sessions.filter(s => s.id !== id);
    delete panelInstances[id];
    delete tabButtons[id];
    if (activeId === id) {
      activeId = sessions[Math.max(0, idx - 1)]?.id ?? sessions[0]?.id ?? null;
    }
  }

  function closeToRight(id: string) {
    const idx = sessions.findIndex(s => s.id === id);
    const toRemove = new Set(sessions.slice(idx + 1).map(s => s.id));
    for (const sessionId of toRemove) {
      delete panelInstances[sessionId];
      delete tabButtons[sessionId];
    }
    if (toRemove.has(activeId ?? '')) activeId = id;
    sessions = sessions.filter(s => !toRemove.has(s.id));
  }

  // ── Context menu ──────────────────────────────────────────────────────────
  type CtxMenu = { sessionId: string; x: number; y: number };
  let ctxMenu = $state<CtxMenu | null>(null);

  function openCtxMenu(e: MouseEvent, sessionId: string) {
    e.preventDefault();
    e.stopPropagation();
    ctxMenu = { sessionId, x: e.clientX, y: e.clientY };
  }

  function ctxMenuItems(sessionId: string): MenuItem[] {
    const idx = sessions.findIndex(s => s.id === sessionId);
    const items: MenuItem[] = [
      {
        label: 'Rename',
        action: () => {
          renamingId = sessionId;
          renameValue = sessions.find(s => s.id === sessionId)?.label ?? '';
        },
      },
      { separator: true },
      {
        label: 'Close',
        action: () => closeSession(sessionId),
        danger: true,
      },
    ];
    if (idx < sessions.length - 1) {
      items.push({
        label: 'Close to right',
        action: () => closeToRight(sessionId),
        danger: true,
      });
    }
    return items;
  }

  // ── Inline rename ─────────────────────────────────────────────────────────
  let renamingId = $state<string | null>(null);
  let renameValue = $state('');

  function commitRename() {
    if (!renamingId) return;
    const trimmed = renameValue.trim();
    if (trimmed) {
      sessions = sessions.map(s => (s.id === renamingId ? { ...s, label: trimmed } : s));
    }
    renamingId = null;
  }

  function cancelRename() {
    renamingId = null;
  }

  /** Svelte action: focuses and selects an input immediately on mount. */
  function focusInput(node: HTMLInputElement) {
    node.focus();
    node.select();
  }

  // ── Pointer-based drag reordering ────────────────────────────────────────
  // Uses pointer events instead of the HTML5 drag API. The HTML5 drag API is
  // unreliable in Tauri WebView2: re-rendering the dragged element (e.g. to add
  // an opacity class) causes WebView2 to cancel the drag operation.
  let dragFromId = $state<string | null>(null);
  let dragToId = $state<string | null>(null);
  let dragToSide = $state<'before' | 'after'>('after');
  let dragPointerId = $state<number | null>(null);

  // Walk up the DOM from a point to find the nearest tab's session id.
  function getSessionIdAt(x: number, y: number): string | null {
    let el = document.elementFromPoint(x, y) as HTMLElement | null;
    while (el) {
      if (el.dataset.sessionId) return el.dataset.sessionId;
      el = el.parentElement;
    }
    return null;
  }

  // Reference to the tab strip wrapper — used to detect drags into empty space.
  let tabStripEl = $state<HTMLElement | null>(null);

  function onTabPointerDown(e: PointerEvent, id: string) {
    if (e.button !== 0) return;
    dragFromId = id;
    dragPointerId = e.pointerId;
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
  }

  function onTabPointerMove(e: PointerEvent) {
    if (!dragFromId) return;
    e.preventDefault(); // prevent text selection while dragging
    const targetId = getSessionIdAt(e.clientX, e.clientY);
    if (targetId && targetId !== dragFromId) {
      dragToId = targetId;
      // Find the target element for left/right side detection.
      let el = document.elementFromPoint(e.clientX, e.clientY) as HTMLElement | null;
      while (el && !el.dataset.sessionId) el = el.parentElement;
      if (el) {
        const rect = el.getBoundingClientRect();
        dragToSide = e.clientX < rect.left + rect.width / 2 ? 'before' : 'after';
      }
    } else if (!targetId && tabStripEl) {
      // Pointer is in the tab strip area but not over any tab — treat as append-to-end.
      const rect = tabStripEl.getBoundingClientRect();
      if (e.clientY >= rect.top && e.clientY <= rect.bottom && e.clientX >= rect.left) {
        const last = sessions.findLast(s => s.id !== dragFromId);
        if (last) {
          dragToId = last.id;
          dragToSide = 'after';
        }
      } else {
        dragToId = null;
      }
    } else {
      dragToId = null;
    }
  }

  function onTabPointerUp(e: PointerEvent) {
    if (
      dragPointerId !== null &&
      (e.currentTarget as HTMLElement).hasPointerCapture(dragPointerId)
    ) {
      (e.currentTarget as HTMLElement).releasePointerCapture(dragPointerId);
    }
    if (dragFromId && dragToId && dragFromId !== dragToId) {
      const fromIdx = sessions.findIndex(s => s.id === dragFromId);
      const arr = [...sessions];
      const [moved] = arr.splice(fromIdx, 1);
      let insertAt = arr.findIndex(s => s.id === dragToId);
      if (dragToSide === 'after') insertAt += 1;
      arr.splice(insertAt, 0, moved);
      sessions = arr;
    }
    dragFromId = null;
    dragToId = null;
    dragPointerId = null;
  }

  function focusTabButton(sessionId: string) {
    tabButtons[sessionId]?.focus();
  }

  function onTabKeyDown(e: KeyboardEvent, sessionId: string) {
    const idx = sessions.findIndex(s => s.id === sessionId);
    if (idx === -1) return;

    if (e.key === 'ArrowRight') {
      e.preventDefault();
      const next = sessions[(idx + 1) % sessions.length];
      if (next) {
        activeId = next.id;
        focusTabButton(next.id);
      }
      return;
    }

    if (e.key === 'ArrowLeft') {
      e.preventDefault();
      const prev = sessions[(idx - 1 + sessions.length) % sessions.length];
      if (prev) {
        activeId = prev.id;
        focusTabButton(prev.id);
      }
      return;
    }

    if (e.key === 'Home') {
      e.preventDefault();
      const first = sessions[0];
      if (first) {
        activeId = first.id;
        focusTabButton(first.id);
      }
      return;
    }

    if (e.key === 'End') {
      e.preventDefault();
      const last = sessions[sessions.length - 1];
      if (last) {
        activeId = last.id;
        focusTabButton(last.id);
      }
    }
  }

  // ── Layout helpers ────────────────────────────────────────────────────────
  const wrapperStyle = $derived.by(() => {
    if (layout === 'split') return 'display:flex; flex-direction:row;';
    if (layout === 'grid') {
      const cols = sessions.length >= 2 ? 2 : 1;
      return `display:grid; grid-template-columns:repeat(${cols},1fr); grid-auto-rows:1fr;`;
    }
    return 'display:flex; flex-direction:column;';
  });

  function panelStyle(sessionId: string): string {
    if (layout === 'tabs') {
      return activeId === sessionId
        ? 'display:flex; flex-direction:column; flex:1; min-height:0;'
        : 'display:none;';
    }
    return 'display:flex; flex-direction:column; flex:1; min-height:0; overflow:hidden;';
  }
</script>

<div class="flex min-h-0 flex-1 flex-col overflow-hidden bg-[var(--sg-bg)]">
  <!-- ── Toolbar ─────────────────────────────────────────────────────────── -->
  <div
    class="flex shrink-0 items-center gap-1 border-b border-[var(--sg-border)] bg-[var(--sg-bg)] px-1.5"
    style="min-height: 32px;"
  >
    <!-- Session tab strip -->
    <div
      bind:this={tabStripEl}
      role="tablist"
      aria-label="Terminal sessions"
      class="flex min-w-0 flex-1 items-center gap-0.5 overflow-x-auto py-0.5"
    >
      {#each sessions as session (session.id)}
        {@const isActive = activeId === session.id}
        {@const isDragTarget = dragToId === session.id}
        <!-- svelte-ignore a11y_no_static_element_interactions -->
        <div
          data-session-id={session.id}
          class="relative flex shrink-0 items-stretch overflow-hidden rounded transition-colors
            {isActive ? 'bg-[var(--sg-surface-raised)]' : 'hover:bg-[var(--sg-surface)]'}
            {dragFromId === session.id ? 'opacity-50' : ''}"
          onpointerdown={e => onTabPointerDown(e, session.id)}
          onpointermove={onTabPointerMove}
          onpointerup={onTabPointerUp}
          oncontextmenu={e => openCtxMenu(e, session.id)}
        >
          <!-- Drop indicator: left edge -->
          {#if isDragTarget && dragToSide === 'before'}
            <span
              class="pointer-events-none absolute top-0 left-0 h-full w-0.5 rounded-full bg-[var(--sg-primary)]"
            ></span>
          {/if}

          <!-- Tab label (or inline rename input) -->
          {#if renamingId === session.id}
            <input
              use:focusInput
              draggable="false"
              type="text"
              bind:value={renameValue}
              onblur={commitRename}
              onkeydown={e => {
                if (e.key === 'Enter') commitRename();
                if (e.key === 'Escape') cancelRename();
                e.stopPropagation();
              }}
              onclick={e => e.stopPropagation()}
              class="min-w-0 w-[100px] rounded bg-[var(--sg-input-bg)] px-2 py-1 text-[11px] font-medium text-[var(--sg-text)] outline outline-1 outline-[var(--sg-primary)] focus:outline-[var(--sg-primary)]"
            />
          {:else}
            <!--
              draggable="false" + select-none on the button prevents the browser
              from treating a drag-start on the button text as a 'text selection drag'
              instead of the parent div's HTML5 drag operation.
            -->
            <button
              bind:this={tabButtons[session.id]}
              draggable="false"
              role="tab"
              id={`terminal-tab-${session.id}`}
              tabindex={isActive ? 0 : -1}
              aria-selected={isActive}
              aria-controls={`terminal-panel-${session.id}`}
              onkeydown={e => onTabKeyDown(e, session.id)}
              onclick={e => {
                e.stopPropagation();
                activeId = session.id;
              }}
              class="select-none flex items-center gap-1.5 px-2.5 py-1 text-[11px] font-medium transition-colors
                {isActive ? 'text-[var(--sg-primary)]' : 'text-[var(--sg-text)]'}"
            >
              <span
                class="h-1.5 w-1.5 shrink-0 rounded-full transition-colors
                  {isActive ? 'bg-[var(--sg-primary)]' : 'bg-[var(--sg-text-faint)]'}"
              ></span>
              <span class="max-w-[100px] truncate">{session.label}</span>
            </button>
          {/if}

          <!-- Close button -->
          <button
            draggable="false"
            onpointerdown={e => e.stopPropagation()}
            onclick={e => {
              e.stopPropagation();
              closeSession(session.id);
            }}
            title="Close {session.label}"
            class="select-none flex items-center px-1.5 text-[11px] leading-none text-[var(--sg-text-dim)] transition-colors hover:text-[var(--sg-danger)]"
            >✕</button
          >

          <!-- Drop indicator: right edge -->
          {#if isDragTarget && dragToSide === 'after'}
            <span
              class="pointer-events-none absolute top-0 right-0 h-full w-0.5 rounded-full bg-[var(--sg-primary)]"
            ></span>
          {/if}
        </div>
      {/each}
    </div>

    <!-- Add terminal button + shell picker -->
    <div class="relative shrink-0">
      <button
        data-testid="btn-add-terminal"
        onclick={e => {
          e.stopPropagation();
          if (availableShells.length <= 1) {
            addSession(defaultShell);
          } else {
            showAddMenu = !showAddMenu;
          }
        }}
        title="New terminal"
        class="flex items-center gap-0.5 rounded px-2 py-1 text-[var(--sg-text-faint)] transition-colors hover:bg-[var(--sg-surface-raised)] hover:text-[var(--sg-text-dim)]"
      >
        <svg width="13" height="13" viewBox="0 0 13 13" fill="none">
          <path
            d="M6.5 2v9M2 6.5h9"
            stroke="currentColor"
            stroke-width="1.5"
            stroke-linecap="round"
          />
        </svg>
        {#if availableShells.length > 1}
          <svg width="8" height="8" viewBox="0 0 8 8" fill="none" class="opacity-60">
            <path
              d="M1 2.5l3 3 3-3"
              stroke="currentColor"
              stroke-width="1.2"
              stroke-linecap="round"
            />
          </svg>
        {/if}
      </button>

      {#if showAddMenu}
        <div
          class="absolute top-full right-0 z-50 mt-0.5 min-w-[110px] overflow-hidden rounded-md border border-[var(--sg-border)] bg-[var(--sg-surface)] py-1 shadow-xl"
          style="animation: sg-fade-in 0.1s ease-out"
        >
          {#each availableShells as shell}
            <button
              data-testid="terminal-shell-option"
              onclick={e => {
                e.stopPropagation();
                addSession(shell);
              }}
              class="block w-full px-3 py-1.5 text-left font-mono text-xs text-[var(--sg-text-dim)] hover:bg-[var(--sg-surface-raised)] hover:text-[var(--sg-text)]"
              >{shell}</button
            >
          {/each}
        </div>
      {/if}
    </div>

    <!-- Separator -->
    <div class="mx-0.5 h-3.5 w-px bg-[var(--sg-border)]"></div>

    <!-- Layout toggles -->
    <div class="flex shrink-0 items-center gap-0.5 py-0.5">
      <button
        onclick={() => (layout = 'tabs')}
        title="Tabbed (one at a time)"
        class="rounded p-1 transition-colors {layout === 'tabs'
          ? 'bg-[var(--sg-surface-raised)] text-[var(--sg-primary)]'
          : 'text-[var(--sg-text-faint)] hover:bg-[var(--sg-surface-raised)] hover:text-[var(--sg-text-dim)]'}"
      >
        <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
          <rect x="1" y="5" width="12" height="8" rx="1" stroke="currentColor" stroke-width="1.2" />
          <path
            d="M1 5h3v-2a1 1 0 011-1h0a1 1 0 011 1v2"
            stroke="currentColor"
            stroke-width="1.2"
            stroke-linejoin="round"
          />
        </svg>
      </button>
      <button
        onclick={() => (layout = 'split')}
        title="Split (side by side)"
        class="rounded p-1 transition-colors {layout === 'split'
          ? 'bg-[var(--sg-surface-raised)] text-[var(--sg-primary)]'
          : 'text-[var(--sg-text-faint)] hover:bg-[var(--sg-surface-raised)] hover:text-[var(--sg-text-dim)]'}"
      >
        <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
          <rect
            x="1"
            y="1.5"
            width="5"
            height="11"
            rx="1"
            stroke="currentColor"
            stroke-width="1.2"
          />
          <rect
            x="8"
            y="1.5"
            width="5"
            height="11"
            rx="1"
            stroke="currentColor"
            stroke-width="1.2"
          />
        </svg>
      </button>
      <button
        onclick={() => (layout = 'grid')}
        title="Grid (2-column)"
        class="rounded p-1 transition-colors {layout === 'grid'
          ? 'bg-[var(--sg-surface-raised)] text-[var(--sg-primary)]'
          : 'text-[var(--sg-text-faint)] hover:bg-[var(--sg-surface-raised)] hover:text-[var(--sg-text-dim)]'}"
      >
        <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
          <rect
            x="1"
            y="1"
            width="5"
            height="5"
            rx="0.8"
            stroke="currentColor"
            stroke-width="1.2"
          />
          <rect
            x="8"
            y="1"
            width="5"
            height="5"
            rx="0.8"
            stroke="currentColor"
            stroke-width="1.2"
          />
          <rect
            x="1"
            y="8"
            width="5"
            height="5"
            rx="0.8"
            stroke="currentColor"
            stroke-width="1.2"
          />
          <rect
            x="8"
            y="8"
            width="5"
            height="5"
            rx="0.8"
            stroke="currentColor"
            stroke-width="1.2"
          />
        </svg>
      </button>
    </div>
  </div>

  <!-- ── Terminal panels ───────────────────────────────────────────────────── -->
  <!--
    ALL panels are always in the DOM — layout changes only update CSS.
    bind:this wires up the focus() method so clicking a tab focuses that terminal.
  -->
  {#if sessions.length === 0}
    <div class="flex flex-1 flex-col items-center justify-center gap-1.5">
      <p class="text-sm text-[var(--sg-text-faint)]">No terminal sessions</p>
      <p class="text-xs text-[var(--sg-text-faint)]">Click <span class="font-mono">+</span> to start one</p>
    </div>
  {:else}
    <div class="min-h-0 flex-1 overflow-hidden" style={wrapperStyle}>
      {#each sessions as session (session.id)}
        <!-- svelte-ignore a11y_no_static_element_interactions -->
        <div
          id={`terminal-panel-${session.id}`}
          role="tabpanel"
          tabindex={activeId === session.id ? 0 : -1}
          aria-labelledby={`terminal-tab-${session.id}`}
          style={panelStyle(session.id)}
          onpointerdown={() => (activeId = session.id)}
          class:border-l={layout === 'split' && sessions.indexOf(session) > 0}
          class:border-[var(--sg-border)]={layout === 'split' && sessions.indexOf(session) > 0}
          class:border={layout === 'grid'}
          class:border-[var(--sg-border-subtle)]={layout === 'grid'}
        >
          <TerminalPanel
            bind:this={panelInstances[session.id]}
            shell={session.shell}
            {cwd}
            initialCommand={session.initialCommand}
          />
        </div>
      {/each}
    </div>
  {/if}
</div>

<!-- ── Context menu ──────────────────────────────────────────────────────── -->
{#if ctxMenu}
  <ContextMenu
    x={ctxMenu.x}
    y={ctxMenu.y}
    items={ctxMenuItems(ctxMenu.sessionId)}
    onclose={() => (ctxMenu = null)}
  />
{/if}
