import { useEffect, useRef } from 'react';
import { Terminal } from '@xterm/xterm';
import { FitAddon } from '@xterm/addon-fit';
import { WebLinksAddon } from '@xterm/addon-web-links';

// xterm.js renders to a canvas — CSS variables are not resolved there.
// We use concrete hex values, matched to the SproutGit design tokens.

/** Catppuccin Latte — light mode */
const LIGHT_THEME = {
  background:          '#eff1f5',
  foreground:          '#4c4f69',
  cursor:              '#179299',
  cursorAccent:        '#eff1f5',
  selectionBackground: 'rgba(23,146,153,0.25)',
  black:               '#5c5f77',
  red:                 '#d20f39',
  green:               '#40a02b',
  yellow:              '#df8e1d',
  blue:                '#1e66f5',
  magenta:             '#8839ef',
  cyan:                '#179299',
  white:               '#acb0be',
  brightBlack:         '#6c6f85',
  brightRed:           '#d20f39',
  brightGreen:         '#40a02b',
  brightYellow:        '#df8e1d',
  brightBlue:          '#1e66f5',
  brightMagenta:       '#8839ef',
  brightCyan:          '#179299',
  brightWhite:         '#bcc0cc',
};

/** Catppuccin Mocha — dark mode */
const DARK_THEME = {
  background:          '#1e1e2e',
  foreground:          '#cdd6f4',
  cursor:              '#19ac5c',
  cursorAccent:        '#1e1e2e',
  selectionBackground: 'rgba(25,172,92,0.25)',
  black:               '#45475a',
  red:                 '#f38ba8',
  green:               '#a6e3a1',
  yellow:              '#f9e2af',
  blue:                '#89b4fa',
  magenta:             '#cba6f7',
  cyan:                '#94e2d5',
  white:               '#bac2de',
  brightBlack:         '#585b70',
  brightRed:           '#f38ba8',
  brightGreen:         '#a6e3a1',
  brightYellow:        '#f9e2af',
  brightBlue:          '#89b4fa',
  brightMagenta:       '#cba6f7',
  brightCyan:          '#94e2d5',
  brightWhite:         '#a6adc8',
};

function resolveTheme() {
  // SproutGit only follows the OS-level color scheme (no in-app light/dark
  // toggle) — mirrors MonacoEditor's resolveTheme() rather than comparing
  // against a hardcoded --sg-bg hex value, which would silently break if
  // that token's value ever changed.
  const isDark = typeof window !== 'undefined' && window.matchMedia('(prefers-color-scheme: dark)').matches;
  return isDark ? DARK_THEME : LIGHT_THEME;
}

type Props = {
  /** Session ID managed by the main process TerminalManager. */
  sessionId: string;
  /** Called when the user types — forwards raw data to the PTY. */
  onData: (sessionId: string, data: string) => void;
  /** Called when the terminal is resized so the PTY can be updated. */
  onResize: (sessionId: string, cols: number, rows: number) => void;
  /** Incoming data from the PTY to render. */
  incomingData?: string;
  /** Characters permanently dropped from the front of `incomingData` by the
   *  caller's buffer cap. `incomingData` is otherwise treated as an
   *  ever-growing stream; this offset keeps the write-delta math correct
   *  once older data has been trimmed out from under it. */
  droppedLen?: number;
  className?: string;
};

const isWindows = typeof navigator !== 'undefined' && /windows/i.test(navigator.userAgent);

/**
 * A headless xterm.js terminal that delegates PTY I/O to the Electron main
 * process via the `onData` / `onResize` callbacks. The parent is responsible
 * for piping incoming data via the `incomingData` prop.
 */
export function TerminalPane({ sessionId, onData, onResize, incomingData, droppedLen, className }: Props) {
  const containerRef = useRef<HTMLDivElement>(null);
  const termRef = useRef<Terminal | null>(null);
  const fitAddonRef = useRef<FitAddon | null>(null);
  /** Tracks how many characters of the full (untrimmed) stream have already
   *  been written — i.e. an absolute position, not an offset into the
   *  current (possibly trimmed) `incomingData`. */
  const writtenLenRef = useRef<number>(0);

  // Mount terminal once.
  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    const termOptions: ConstructorParameters<typeof Terminal>[0] & { windowsMode?: boolean } = {
      fontFamily: '"Cascadia Code", "JetBrains Mono", "Fira Code", Menlo, monospace',
      fontSize: 13,
      lineHeight: 1.2,
      cursorBlink: true,
      allowTransparency: false,
      scrollback: 5000,
      theme: resolveTheme(),
    };
    if (isWindows) termOptions.windowsMode = true;

    const term = new Terminal(termOptions);

    const fitAddon = new FitAddon();
    term.loadAddon(fitAddon);
    term.loadAddon(new WebLinksAddon());
    term.open(container);

    // Register onData / onResize BEFORE the first fit() so that the initial
    // fit immediately propagates the correct cols/rows to the PTY.
    term.onData(data => onData(sessionId, data));
    term.onResize(({ cols, rows }) => onResize(sessionId, cols, rows));

    // Clipboard keyboard shortcuts.
    // - Ctrl+C / Cmd+C with selection → copy, suppress ^C interrupt.
    // - Ctrl+C / Cmd+C without selection → pass through as ^C interrupt.
    // - Ctrl+Shift+C → always copy (belt-and-suspenders).
    // Paste (Ctrl+V / Cmd+V) is intentionally NOT intercepted here — xterm.js
    // handles it natively via the browser's paste event on its inner textarea,
    // so intercepting it here and also calling term.paste() causes double-paste.
    const isMac = navigator.platform.toLowerCase().includes('mac');
    term.attachCustomKeyEventHandler((event: KeyboardEvent) => {
      if (event.type !== 'keydown') return true;
      // Copy
      if (
        (isMac && event.metaKey && !event.shiftKey && event.code === 'KeyC') ||
        (!isMac && event.ctrlKey && !event.shiftKey && event.code === 'KeyC')
      ) {
        const sel = term.getSelection();
        if (sel) {
          void navigator.clipboard.writeText(sel);
          return false; // consume — don't also send ^C
        }
        return true; // no selection — let ^C pass through as interrupt
      }
      // Ctrl+Shift+C always copies
      if (!isMac && event.ctrlKey && event.shiftKey && event.code === 'KeyC') {
        const sel = term.getSelection();
        if (sel) void navigator.clipboard.writeText(sel);
        return false;
      }
      return true;
    });

    termRef.current = term;
    fitAddonRef.current = fitAddon;
    (container as HTMLDivElement & { __xterm?: Terminal }).__xterm = term;

    const observer = new ResizeObserver(() => fitAddon.fit());
    observer.observe(container);

    const colorSchemeQuery = window.matchMedia('(prefers-color-scheme: dark)');
    const onColorSchemeChange = () => { term.options.theme = resolveTheme(); };
    colorSchemeQuery.addEventListener('change', onColorSchemeChange);

    // Fit now that all listeners are registered — this propagates cols/rows to
    // the PTY via onResize.  A second fit in rAF catches any layout changes
    // that happen between now and the first paint (flex containers, etc.).
    fitAddon.fit();
    const rafId = requestAnimationFrame(() => {
      if (fitAddonRef.current) fitAddonRef.current.fit();
    });

    return () => {
      cancelAnimationFrame(rafId);
      observer.disconnect();
      colorSchemeQuery.removeEventListener('change', onColorSchemeChange);
      delete (container as HTMLDivElement & { __xterm?: Terminal }).__xterm;
      term.dispose();
      termRef.current = null;
      fitAddonRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sessionId]);

  // Reset the written-length counter whenever the session changes.
  useEffect(() => {
    writtenLenRef.current = 0;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sessionId]);

  // Write incoming PTY data — only the new delta since the last write.
  // `incomingData` may have been trimmed from the front (its absolute start
  // position is `droppedLen`), so the slice offset is relative to that
  // absolute start rather than to the string itself.
  useEffect(() => {
    if (incomingData && termRef.current) {
      const absoluteStart = droppedLen ?? 0;
      const relativeOffset = Math.max(0, writtenLenRef.current - absoluteStart);
      const delta = incomingData.slice(relativeOffset);
      if (delta) termRef.current.write(delta);
      writtenLenRef.current = absoluteStart + incomingData.length;
    }
  }, [incomingData, droppedLen]);

  return (
    <div
      className={className}
      style={{ display: 'flex', flexDirection: 'column', overflow: 'hidden', background: 'var(--sg-bg)' }}
    >
      <div
        ref={containerRef}
        data-testid="terminal-container"
        data-sg-terminal="true"
        data-pty-id={sessionId}
        style={{ flex: 1, overflow: 'hidden', margin: '4px 8px 6px' }}
      />
    </div>
  );
}
