import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, isAbsolute, join, resolve } from 'node:path';

import type { TestInfo } from '@playwright/test';
import type { BrowserPageAdapter, TauriPage } from '@srsholmes/tauri-playwright';

import { ROOT } from './fixtures';

function resolveTargetDir() {
  const target = process.env.PLAYWRIGHT_SCREENSHOT_TARGET;
  if (!target) {
    return join(ROOT, 'test-results', 'screenshots');
  }
  return isAbsolute(target) ? target : resolve(ROOT, target);
}

function slug(value: string) {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

// ── Window sizing ─────────────────────────────────────────────────────────────

/**
 * Resize the Tauri window to a compact size suitable for marketing screenshots.
 * Calls the `set_window_size` Tauri command (compiled in with the `e2e-testing`
 * feature) so the resize is synchronous and fully awaited before returning.
 */
export async function resizeWindowForScreenshot(
  tauriPage: TauriPage | BrowserPageAdapter,
  width = 960,
  height = 620
) {
  try {
    await tauriPage.evaluate(
      `window.__TAURI_INTERNALS__.invoke('set_window_size', { width: ${width}, height: ${height} })`
    );
    // Brief pause so the OS has time to finish compositing the resized window
    // before we capture a screenshot.
    await new Promise(r => setTimeout(r, 300));
  } catch {
    // Non-fatal: proceed with the current window size
  }
}

// ── Theme forcing ────────────────────────────────────────────────────────────

const LIGHT_CSS_VARS =
  '--sg-bg:#f5f5f5;--sg-surface:#ffffff;--sg-surface-raised:#eaeaef;' +
  '--sg-border:#d4d4dc;--sg-border-subtle:#e0e0e8;--sg-text:#1e1e2e;' +
  '--sg-text-dim:#555568;--sg-text-faint:#8888a0;--sg-primary:#1a8a5c;' +
  '--sg-primary-hover:#15724d;--sg-danger:#c4314b;--sg-warning:#9a6700;' +
  '--sg-accent:#2563eb;--sg-avatar-bg:#dbe9e2;--sg-avatar-text:#3c4a45;' +
  '--sg-input-bg:#ffffff;--sg-input-border:#d4d4dc;--sg-input-focus:#1a8a5c';

const DARK_CSS_VARS =
  '--sg-bg:#1e1e2e;--sg-surface:#262637;--sg-surface-raised:#2e2e42;' +
  '--sg-border:#3a3a52;--sg-border-subtle:#32324a;--sg-text:#cdd6f4;' +
  '--sg-text-dim:#8b8fad;--sg-text-faint:#6c7086;--sg-primary:#74c7a4;' +
  '--sg-primary-hover:#8bd5b5;--sg-danger:#f38ba8;--sg-warning:#f9e2af;' +
  '--sg-accent:#89b4fa;--sg-avatar-bg:#2b3b35;--sg-avatar-text:#d3ddd8;' +
  '--sg-input-bg:#1a1a2a;--sg-input-border:#3a3a52;--sg-input-focus:#74c7a4';

// Catppuccin Latte (light) and Catppuccin Mocha (dark) xterm canvas themes.
// Must match the palette used in TerminalPanel.svelte.
const LIGHT_XTERM_THEME = {
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

const DARK_XTERM_THEME = {
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

async function forceTheme(tauriPage: TauriPage | BrowserPageAdapter, theme: 'light' | 'dark') {
  const termBg = theme === 'dark' ? DARK_XTERM_THEME.background : LIGHT_XTERM_THEME.background;
  const cssVars = theme === 'dark' ? DARK_CSS_VARS : LIGHT_CSS_VARS;
  // Include a rule that forces the terminal wrapper background to match the
  // selected screenshot theme so the wrapper stays in sync with the xterm canvas.
  const css = JSON.stringify(
    `:root{${cssVars}} [data-sg-terminal]{background-color:${termBg}!important}`
  );
  await tauriPage.evaluate(
    `(() => {
      let el = document.getElementById('sg-forced-theme');
      if (!el) {
        el = document.createElement('style');
        el.id = 'sg-forced-theme';
        document.head.appendChild(el);
      }
      el.textContent = ${css};
    })()`
  );
  // Update any live xterm terminal instances so the canvas reflects the theme.
  // Setting options.theme alone queues a repaint; refresh() forces it synchronously.
  const xtermTheme = JSON.stringify(theme === 'dark' ? DARK_XTERM_THEME : LIGHT_XTERM_THEME);
  await tauriPage.evaluate(
    `(() => {
      const containers = document.querySelectorAll('[data-pty-id]');
      for (const el of containers) {
        if (el.__xterm) {
          el.__xterm.options.theme = ${xtermTheme};
          el.__xterm.refresh(0, el.__xterm.rows - 1);
        }
      }
    })()`
  );
  // Give the canvas renderer and webview compositor time to complete the repaint.
  await new Promise(resolve => setTimeout(resolve, 300));
}

// ── Path redaction ───────────────────────────────────────────────────────────

/**
 * Walk all text nodes in the document and replace absolute filesystem paths
 * with a canonical fake path so screenshots don't reveal real user directories.
 * Keeps the last two path segments to preserve meaningful context.
 */
async function redactPaths(tauriPage: TauriPage | BrowserPageAdapter) {
  await tauriPage.evaluate(`(() => {
    const FAKE_ABS_BASE = '~/Projects/my-project';
    const FAKE_HOME_BASE = '~/Projects';
    // Negative lookbehind: only match '/' NOT preceded by '~' or a word char.
    // This makes the replacement idempotent — re-running on already-replaced text
    // does nothing because every slash in the fake path is preceded by '~' or a letter.
    const ABS_PATH = /(?<![~\\w])\\/[^\\s"'<>]+(\\/[^\\s"'<>]+)+/g;
    const HOME_PATH = /~\\/[^\\s"'<>]+(\\/[^\\s"'<>]+)+/g;

    function fakeTail(match, base) {
      const parts = match.split('/').filter(Boolean);
      if (parts.at(-1) === 'root') {
        const workspaceName = parts.at(-2) ?? 'project';
        return base + '/' + workspaceName;
      }
      const tail = parts.slice(-2).join('/');
      return base + '/' + tail;
    }

    function replacePaths(text) {
      return text
        .replace(ABS_PATH, (match) => fakeTail(match, FAKE_ABS_BASE))
        .replace(HOME_PATH, (match) => fakeTail(match, FAKE_HOME_BASE));
    }

    function walk(node) {
      if (node.nodeType === 3 /* TEXT_NODE */) {
        const replaced = replacePaths(node.textContent ?? '');
        if (replaced !== node.textContent) node.textContent = replaced;
      } else {
        for (const child of Array.from(node.childNodes)) walk(child);
      }
    }
    walk(document.body);
  })()`);
}

// ── Settle helper ─────────────────────────────────────────────────────────────

/**
 * Wait until there are no visible spinners or toast notifications,
 * and all short CSS entrance animations have had time to complete.
 */
async function waitForUiSettle(tauriPage: TauriPage | BrowserPageAdapter, timeout = 10_000) {
  await tauriPage.waitForFunction(
    `(() => {
      const spinners = document.querySelectorAll('[data-testid="spinner"]');
      const toasts   = document.querySelectorAll('[data-testid="toast-item"]');
      return spinners.length === 0 && toasts.length === 0;
    })()`,
    timeout
  );
  // Allow short entrance animations (sg-fade-in ~0.3s, sg-slide-up ~0.25s) to finish.
  await new Promise(resolve => setTimeout(resolve, 350));
}

// ── Public API ────────────────────────────────────────────────────────────────

export async function captureNamedScreenshot(
  tauriPage: TauriPage | BrowserPageAdapter,
  testInfo: TestInfo,
  name: string
) {
  await waitForUiSettle(tauriPage);
  await redactPaths(tauriPage);
  const dir = resolveTargetDir();
  // Support '/' separators for subdirectory organisation (e.g. 'workspace/commit-graph').
  const filename = `${name.split('/').map(slug).join('/')}.png`;
  const outputPath = join(dir, filename);
  mkdirSync(dirname(outputPath), { recursive: true });
  // Don't pass path to tauriPage.screenshot() — the native plugin won't
  // overwrite an existing file. Instead, receive the buffer and write it
  // ourselves so each run always replaces the previous screenshot.
  const png = await tauriPage.screenshot();
  writeFileSync(outputPath, png);
  // Also write to the root screenshots/ folder so both locations stay in sync.
  const rootOutputPath = join(ROOT, 'screenshots', filename);
  mkdirSync(dirname(rootOutputPath), { recursive: true });
  writeFileSync(rootOutputPath, png);
  await testInfo.attach(name, {
    body: png,
    contentType: 'image/png',
  });
  return outputPath;
}

/**
 * Capture both a light and dark variant of the current UI state.
 * Produces `<name>-light.png` and `<name>-dark.png`.
 * Restores light mode after both shots are taken.
 */
export async function captureScreenshotVariants(
  tauriPage: TauriPage | BrowserPageAdapter,
  testInfo: TestInfo,
  name: string
) {
  await forceTheme(tauriPage, 'light');
  await new Promise(resolve => setTimeout(resolve, 150));
  await captureNamedScreenshot(tauriPage, testInfo, `${name}-light`);

  await forceTheme(tauriPage, 'dark');
  await new Promise(resolve => setTimeout(resolve, 150));
  await captureNamedScreenshot(tauriPage, testInfo, `${name}-dark`);

  // Restore light as default for subsequent interactions.
  await forceTheme(tauriPage, 'light');
}
