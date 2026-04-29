<script lang="ts">
  import '@xterm/xterm/css/xterm.css';
  import { onMount, onDestroy } from 'svelte';
  import type { Terminal as XTerm } from '@xterm/xterm';
  import type { FitAddon } from '@xterm/addon-fit';
  import type { WebLinksAddon as WebLinksAddonType } from '@xterm/addon-web-links';
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
    /** Optional command block to send once the terminal is ready. */
    initialCommand?: string;
  };

  const { shell, cwd, initialCommand = '' }: Props = $props();
  const isWindows = typeof navigator !== 'undefined' && /windows/i.test(navigator.userAgent);

  // ── DOM & xterm refs ──────────────────────────────────────────────────────
  let containerEl = $state<HTMLDivElement | null>(null);
  let term: XTerm | null = null;
  let fitAddon: FitAddon | null = null;
  let webLinksAddon: WebLinksAddonType | null = null;

  // ── Session state ─────────────────────────────────────────────────────────
  let ptyId = $state<string | null>(null);
  let closed = $state(false);
  let error = $state<string | null>(null);
  let sentInitialCommand = $state(false);

  // ── Event cleanup ─────────────────────────────────────────────────────────
  let unlistenOutput: UnlistenFn | null = null;
  let unlistenClosed: UnlistenFn | null = null;
  let resizeObserver: ResizeObserver | null = null;
  let resizeTimer: ReturnType<typeof setTimeout> | null = null;
  let colorSchemeQuery: MediaQueryList | null = null;
  let colorSchemeListener: ((e: MediaQueryListEvent) => void) | null = null;

  // ── Catppuccin Latte (light) terminal theme ─────────────────────────────
  const LIGHT_THEME = {
    background: '#eff1f5',
    foreground: '#4c4f69',
    cursor: '#179299',
    cursorAccent: '#eff1f5',
    selectionBackground: 'rgba(23,146,153,0.25)',
    black: '#5c5f77',
    red: '#d20f39',
    green: '#40a02b',
    yellow: '#df8e1d',
    blue: '#1e66f5',
    magenta: '#8839ef',
    cyan: '#179299',
    white: '#acb0be',
    brightBlack: '#6c6f85',
    brightRed: '#d20f39',
    brightGreen: '#40a02b',
    brightYellow: '#df8e1d',
    brightBlue: '#1e66f5',
    brightMagenta: '#8839ef',
    brightCyan: '#179299',
    brightWhite: '#bcc0cc',
  };

  // ── Catppuccin Mocha (dark) terminal theme ────────────────────────────────
  const DARK_THEME = {
    background: '#1e1e2e',
    foreground: '#cdd6f4',
    cursor: '#19ac5c',
    cursorAccent: '#1e1e2e',
    selectionBackground: 'rgba(25,172,92,0.25)',
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
    const { WebLinksAddon } = await import('@xterm/addon-web-links');
    const { openUrl } = await import('@tauri-apps/plugin-opener');

    // Derive theme from the computed CSS variable rather than matchMedia —
    // WebKit/Tauri doesn't always propagate the system appearance to matchMedia
    // at startup, but app.css already correctly applies --sg-bg via @media.
    const computedBg = getComputedStyle(document.documentElement)
      .getPropertyValue('--sg-bg')
      .trim();
    const prefersDark = computedBg !== '#f5f5f5';
    const xTermTheme = prefersDark ? DARK_THEME : LIGHT_THEME;

    const options: ConstructorParameters<typeof Terminal>[0] & { windowsMode?: boolean } = {
      theme: xTermTheme,
      fontFamily: '"Cascadia Code", "JetBrains Mono", "Fira Code", Menlo, monospace',
      fontSize: 13,
      lineHeight: 1.2,
      cursorBlink: true,
      allowTransparency: false,
      scrollback: 5000,
    };
    if (isWindows) {
      options.windowsMode = true; // Solves the ConPTY resize history-cropping bug on ConPTY
    }
    term = new Terminal(options);

    fitAddon = new FitAddon();
    term.loadAddon(fitAddon);

    webLinksAddon = new WebLinksAddon((_event, uri) => {
      void openUrl(uri);
    });
    term.loadAddon(webLinksAddon);

    term.open(containerEl);
    (containerEl as any).__xterm = term;
    fitAddon.fit();

    // Keep xterm canvas in sync if the OS colour scheme changes after mount.
    colorSchemeQuery = window.matchMedia('(prefers-color-scheme: dark)');
    colorSchemeListener = (e: MediaQueryListEvent) => {
      if (!term) return;
      term.options.theme = e.matches ? DARK_THEME : LIGHT_THEME;
      term.refresh(0, term.rows - 1);
    };
    colorSchemeQuery.addEventListener('change', colorSchemeListener);

    // Forward keyboard input to PTY
    term.onData(data => {
      if (ptyId) void terminalInput(ptyId, data);
    });

    // Observe container resize and notify PTY.
    // Uses a small debounce to avoid flooding ConPTY with resize events
    // while the user is actively dragging the window.
    resizeObserver = new ResizeObserver(entries => {
      if (!fitAddon || !term || !ptyId) return;
      const entry = entries[0];
      if (!entry || entry.contentRect.width === 0 || entry.contentRect.height === 0) {
        // Panel hidden — cancel any pending timer so fit doesn't fire at zero size.
        if (resizeTimer) {
          clearTimeout(resizeTimer);
          resizeTimer = null;
        }
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

      unlistenOutput = await onTerminalOutput(id, data => {
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
    if (resizeTimer) {
      clearTimeout(resizeTimer);
      resizeTimer = null;
    }
    resizeObserver?.disconnect();
    resizeObserver = null;

    if (colorSchemeQuery && colorSchemeListener) {
      colorSchemeQuery.removeEventListener('change', colorSchemeListener);
      colorSchemeQuery = null;
      colorSchemeListener = null;
    }

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
    webLinksAddon = null;
  }

  onMount(() => {
    void initTerminal();
  });

  $effect(() => {
    if (!ptyId || sentInitialCommand || !initialCommand.trim()) {
      return;
    }

    sentInitialCommand = true;
    void terminalInput(ptyId, `${initialCommand}\r`);
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

<div
  class="relative flex min-h-0 flex-1 flex-col overflow-hidden bg-[var(--sg-bg)]"
  data-sg-terminal
>
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
      data-pty-id={ptyId ?? ''}
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
