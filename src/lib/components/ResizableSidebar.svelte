<script lang="ts">
  import { onMount, untrack } from 'svelte';

  type Props = {
    /** Stable key used for localStorage persistence. */
    storageKey: string;
    /** Initial width in pixels (used when nothing is persisted yet). */
    defaultWidth?: number;
    /** Minimum width in pixels. */
    minWidth?: number;
    /** Maximum width in pixels. */
    maxWidth?: number;
    /** Side the resize handle sits on. Defaults to 'right' (sidebar on the left). */
    side?: 'right' | 'left';
    children: import('svelte').Snippet;
  };

  const {
    storageKey,
    defaultWidth = 320,
    minWidth = 240,
    maxWidth = 560,
    side = 'right',
    children,
  }: Props = $props();

  let width = $state(untrack(() => defaultWidth));
  let dragging = $state(false);
  let dragStartX = 0;
  let dragStartWidth = 0;

  const STORAGE_PREFIX = 'sg.sidebarWidth.';

  onMount(() => {
    try {
      const raw = localStorage.getItem(STORAGE_PREFIX + storageKey);
      if (raw) {
        const parsed = parseInt(raw, 10);
        if (Number.isFinite(parsed)) {
          width = Math.min(maxWidth, Math.max(minWidth, parsed));
        }
      }
    } catch {
      // localStorage unavailable; use default.
    }
  });

  function persist() {
    try {
      localStorage.setItem(STORAGE_PREFIX + storageKey, String(Math.round(width)));
    } catch {
      // ignore quota / privacy errors
    }
  }

  function onPointerDown(event: PointerEvent) {
    event.preventDefault();
    dragging = true;
    dragStartX = event.clientX;
    dragStartWidth = width;
    (event.currentTarget as HTMLElement).setPointerCapture(event.pointerId);
  }

  function onPointerMove(event: PointerEvent) {
    if (!dragging) return;
    const delta = event.clientX - dragStartX;
    const next = side === 'right' ? dragStartWidth + delta : dragStartWidth - delta;
    width = Math.min(maxWidth, Math.max(minWidth, next));
  }

  function onPointerUp(event: PointerEvent) {
    if (!dragging) return;
    dragging = false;
    try {
      (event.currentTarget as HTMLElement).releasePointerCapture(event.pointerId);
    } catch {
      // pointer may already be released
    }
    persist();
  }

  function onDoubleClick() {
    width = defaultWidth;
    persist();
  }

  function onKeyDown(event: KeyboardEvent) {
    const step = event.shiftKey ? 48 : 8;
    let next: number | undefined;

    if (event.key === 'ArrowLeft') {
      next = side === 'right' ? width - step : width + step;
    } else if (event.key === 'ArrowRight') {
      next = side === 'right' ? width + step : width - step;
    } else if (event.key === 'Home') {
      next = minWidth;
    } else if (event.key === 'End') {
      next = maxWidth;
    } else {
      return;
    }

    event.preventDefault();
    width = Math.min(maxWidth, Math.max(minWidth, next));
    persist();
  }
</script>

<div
  class="relative flex shrink-0 flex-col"
  style:width="{width}px"
  style:user-select={dragging ? 'none' : ''}
>
  {@render children()}

  <!-- svelte-ignore a11y_no_static_element_interactions -->
  <!-- svelte-ignore a11y_no_noninteractive_tabindex -->
  <!-- svelte-ignore a11y_no_noninteractive_element_interactions -->
  <div
    class="group absolute top-0 bottom-0 z-20 flex w-2 cursor-col-resize items-stretch {side ===
    'right'
      ? '-right-1'
      : '-left-1'}"
    onpointerdown={onPointerDown}
    onpointermove={onPointerMove}
    onpointerup={onPointerUp}
    onpointercancel={onPointerUp}
    ondblclick={onDoubleClick}
    onkeydown={onKeyDown}
    title="Drag to resize · double-click to reset · arrow keys to adjust"
    role="separator"
    aria-orientation="vertical"
    aria-valuenow={width}
    aria-valuemin={minWidth}
    aria-valuemax={maxWidth}
    tabindex="0"
  >
    <div
      class="m-auto h-12 w-[2px] rounded-full transition-colors {dragging
        ? 'bg-[var(--sg-primary)]/70'
        : 'bg-transparent group-hover:bg-[var(--sg-primary)]/50'}"
    ></div>
  </div>
</div>
