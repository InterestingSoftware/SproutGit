<script lang="ts">
  import { onMount, onDestroy } from 'svelte';
  import { getCurrentWindow } from '@tauri-apps/api/window';
  import { Minus, Square, Minimize2, X } from 'lucide-svelte';

  let isWindows = $state(false);
  let isMaximized = $state(false);
  let unlistenResize: (() => void) | undefined;

  onMount(async () => {
    isWindows = navigator.platform.startsWith('Win') || /Windows/.test(navigator.userAgent);
    if (!isWindows) return;

    const win = getCurrentWindow();
    isMaximized = await win.isMaximized();
    unlistenResize = await win.onResized(async () => {
      isMaximized = await win.isMaximized();
    });
  });

  onDestroy(() => {
    unlistenResize?.();
  });

  async function minimize() {
    await getCurrentWindow().minimize();
  }

  async function toggleMaximize() {
    const win = getCurrentWindow();
    if (isMaximized) {
      await win.unmaximize();
    } else {
      await win.maximize();
    }
  }

  async function close() {
    await getCurrentWindow().close();
  }
</script>

{#if isWindows}
  <div
    class="-mr-1 flex h-full items-center"
    role="toolbar"
    aria-label="Window controls"
    aria-orientation="horizontal"
  >
    <button
      onclick={minimize}
      class="flex h-full w-11 items-center justify-center text-[var(--sg-text-dim)] hover:bg-[var(--sg-surface-raised)] hover:text-[var(--sg-text)]"
      title="Minimize"
      aria-label="Minimize"
      data-tauri-drag-region-exclude
    >
      <Minus size={14} />
    </button>
    <button
      onclick={toggleMaximize}
      class="flex h-full w-11 items-center justify-center text-[var(--sg-text-dim)] hover:bg-[var(--sg-surface-raised)] hover:text-[var(--sg-text)]"
      title={isMaximized ? 'Restore' : 'Maximize'}
      aria-label={isMaximized ? 'Restore' : 'Maximize'}
      data-tauri-drag-region-exclude
    >
      {#if isMaximized}
        <Minimize2 size={14} />
      {:else}
        <Square size={14} />
      {/if}
    </button>
    <button
      onclick={close}
      class="close-btn flex h-full w-11 items-center justify-center text-[var(--sg-text-dim)] hover:text-white"
      title="Close"
      aria-label="Close"
      data-tauri-drag-region-exclude
    >
      <X size={14} />
    </button>
  </div>
{/if}

<style>
  .close-btn:hover {
    background-color: var(--sg-danger);
  }
</style>
