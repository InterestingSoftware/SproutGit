<script lang="ts">
  import '@xterm/xterm/css/xterm.css';
  import { onMount, onDestroy } from 'svelte';
  import type { Terminal as XTerm } from '@xterm/xterm';
  import type { FitAddon } from '@xterm/addon-fit';
  import type { UnlistenFn } from '@tauri-apps/api/event';
  import {
    spawnTerminal,
    terminalInput,
    terminalResize,
    closeTerminal,
    onTerminalOutput,
    onTerminalClosed,
  } from '$lib/sproutgit';

  type Props = {
    /** Shell executable to launch (e.g. "pwsh", "zsh", "bash"). */
    shell: string;
    /** Directory to open the shell in. */
    cwd: string;
  };

  let { shell, cwd }: Props = $props();

  // ── DOM & xterm refs ──────────────────────────────────────────────────────
  let containerEl = $state<HTMLDivElement | null>(null);
  let term: XTerm | null = null;
  let fitAddon: FitAddon | null = null;

  // ── Session state ─────────────────────────────────────────────────────────
  let ptyId = $state<string | null>(null);
  let closed = $state(false);
  let error = $state<string | null>(null);

  // ── Event cleanup ─────────────────────────────────────────────────────────
  let unlistenOutput: UnlistenFn | null = null;
  let unlistenClosed: UnlistenFn | null = null;
  let resizeObserver: ResizeObserver | null = null;
  let resizeTimer: ReturnType<typeof setTimeout> | null = null;

  // ── Catppuccin-mocha terminal theme (matches SproutGit dark palette) ──────
  const THEME = {
    background: '#1e1e2e',
    foreground: '#cdd6f4',
    cursor: '#74c7a4',
    cursorAccent: '#1e1e2e',
    selectionBackground: 'rgba(116,199,164,0.25)',
    black: '#45475a',
    red: '#f38ba8',
    green: '#a6e3a1',
    yellow: '#f9e2af',
    blue: '#89b4fa',
    magenta: '#cba6f7',
    cyan: '#94e2d5',
    white: '#bac2de',
    brightBlack: '#585b70',
    brightRed: '#f38ba8',
    brightGreen: '#a6e3a1',
    brightYellow: '#f9e2af',
    brightBlue: '#89b4fa',
    brightMagenta: '#cba6f7',
    brightCyan: '#94e2d5',
    brightWhite: '#a6adc8',
  };

  async function initTerminal() {
    if (!containerEl) return;

    // Dynamically import xterm so it's not included in the initial bundle
    const { Terminal } = await import('@xterm/xterm');
    const { FitAddon } = await import('@xterm/addon-fit');

    term = new Terminal({
      theme: THEME,
      fontFamily: '"Cascadia Code", "JetBrains Mono", "Fira Code", Menlo, monospace',
      fontSize: 13,
      lineHeight: 1.2,
      cursorBlink: true,
      allowTransparency: false,
      scrollback: 5000,
      // @ts-expect-error - Available in xterm but may be missing from types
      windowsMode: true, // Solves the ConPTY resize history-cropping bug
    });

    fitAddon = new FitAddon();
    term.loadAddon(fitAddon);
    term.open(containerEl);
    fitAddon.fit();

    // Forward keyboard input to PTY
    term.onData((data) => {
      if (ptyId) void terminalInput(ptyId, data);
    });

    // Observe container resize and notify PTY.
    // Uses a small debounce to avoid flooding ConPTY with resize events
    // while the user is actively dragging the window.
    resizeObserver = new ResizeObserver((entries) => {
      if (!fitAddon || !term || !ptyId) return;
      const entry = entries[0];
      if (!entry || entry.contentRect.width === 0 || entry.contentRect.height === 0) {
        // Panel hidden — cancel any pending timer so fit doesn't fire at zero size.
        if (resizeTimer) { clearTimeout(resizeTimer); resizeTimer = null; }
        return;
      }
      if (resizeTimer) clearTimeout(resizeTimer);
      resizeTimer = setTimeout(() => {
        resizeTimer = null;
        fitAndResize();
      }, 50);
    });
    resizeObserver.observe(containerEl);

    // Spawn the shell
    try {
      const id = await spawnTerminal(shell, cwd, term.cols, term.rows);
      ptyId = id;

      unlistenOutput = await onTerminalOutput(id, (data) => {
        term?.write(data);
      });

      unlistenClosed = await onTerminalClosed(id, () => {
        closed = true;
        term?.write('\r\n\x1b[2m[process exited]\x1b[0m\r\n');
      });
    } catch (err) {
      error = String(err);
    }
  }

  async function teardown() {
    if (resizeTimer) { clearTimeout(resizeTimer); resizeTimer = null; }
    resizeObserver?.disconnect();
    resizeObserver = null;

    unlistenOutput?.();
    unlistenOutput = null;

    unlistenClosed?.();
    unlistenClosed = null;

    if (ptyId) {
      await closeTerminal(ptyId).catch(() => {});
      ptyId = null;
    }

    term?.dispose();
    term = null;
    fitAddon = null;
  }

  onMount(() => {
    void initTerminal();
  });

  onDestroy(() => {
    void teardown();
  });

  /** Focus the underlying xterm instance so keyboard input works immediately. */
  export function focus() {
    term?.focus();
  }

  /**
   * Fit xterm to the current container size and tell the PTY.
   */
  function fitAndResize() {
    if (!fitAddon || !term || !ptyId) return;
    const dims = fitAddon.proposeDimensions();
    if (!dims || dims.cols <= 0 || dims.rows <= 0) return;

    fitAddon.fit();
    void terminalResize(ptyId, term.cols, term.rows);
  }

  /**
   * Force a fit+resize after revealing a previously-hidden panel
   * (e.g. switching layout from tabs to split).
   * Waits for the next animation frame so the container has its final dimensions.
   */
  export function refit() {
    requestAnimationFrame(() => fitAndResize());
  }
</script>

<!-- xterm.css is imported at the top of the script block via Vite -->

<div class="relative flex min-h-0 flex-1 flex-col overflow-hidden bg-[#1e1e2e]">
  {#if error}
    <div class="flex flex-1 items-center justify-center p-6">
      <div class="max-w-sm text-center">
        <p class="mb-1 text-sm font-medium text-[var(--sg-danger)]">Failed to start terminal</p>
        <p class="text-xs text-[var(--sg-text-faint)]">{error}</p>
      </div>
    </div>
  {:else}
    <!-- xterm mounts here -->
    <div
      bind:this={containerEl}
      class="min-h-0 flex-1"
      style="height: 100%; padding: 6px 8px; box-sizing: border-box;"
    ></div>

    {#if closed}
      <div
        class="absolute right-3 bottom-3 rounded bg-[rgba(0,0,0,0.6)] px-2 py-1 text-[10px] text-[var(--sg-text-faint)]"
      >
        Process exited — close the tab to dismiss
      </div>
    {/if}
  {/if}
</div>
