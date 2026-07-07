/**
 * Screenshot capture utilities for the WDIO/Electron E2E test suite.
 *
 * Ported from old/e2e/helpers/screenshots.ts (Tauri/Playwright).
 * Adapted to use WebdriverIO browser globals (`browser`, `$`).
 *
 * Usage:
 *   import { captureNamedScreenshot, captureScreenshotVariants }
 *     from '../helpers/screenshots.js';
 *
 * Screenshots are written to:
 *   - $SCREENSHOT_TARGET (or $PLAYWRIGHT_SCREENSHOT_TARGET for backward compat)
 *   - e2e/test-results/screenshots/ (default)
 */

import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, isAbsolute, join, resolve } from 'node:path';

// ---------------------------------------------------------------------------
// Platform detection
// ---------------------------------------------------------------------------

const PLATFORM_FOLDER =
  process.platform === 'darwin' ? 'mac' :
  process.platform === 'win32'  ? 'windows' :
  'linux';

// ---------------------------------------------------------------------------
// Resolve output directory
// ---------------------------------------------------------------------------

function resolveTargetDir(): string {
  const env =
    process.env['SCREENSHOT_TARGET'] ??
    process.env['PLAYWRIGHT_SCREENSHOT_TARGET'];
  const base = env
    ? (isAbsolute(env) ? env : resolve(process.cwd(), env))
    : join(resolve(__dirname, '..'), 'test-results', 'screenshots');
  // Nest under a platform subfolder so mac/windows/linux shots are separate.
  return join(base, PLATFORM_FOLDER);
}

function slug(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

// ---------------------------------------------------------------------------
// Theme forcing
// ---------------------------------------------------------------------------

// Light mode: Catppuccin Latte palette (matches styles.css :root defaults)
const LIGHT_CSS_VARS = [
  '--sg-bg:#f5f5f5',
  '--sg-surface:#ffffff',
  '--sg-surface-raised:#eaeaef',
  '--sg-border:#d4d4dc',
  '--sg-border-subtle:#e0e0e8',
  '--sg-text:#1e1e2e',
  '--sg-text-dim:#555568',
  '--sg-text-faint:#8888a0',
  '--sg-primary:#036837',
  '--sg-primary-hover:#19ac5c',
  '--sg-danger:#c4314b',
  '--sg-warning:#9a6700',
  '--sg-accent:#6ac74c',
  '--sg-avatar-bg:#dff0c4',
  '--sg-avatar-text:#036837',
  '--sg-input-bg:#ffffff',
  '--sg-input-border:#d4d4dc',
  '--sg-input-focus:#036837',
].join(';');

// Dark mode: Catppuccin Mocha palette (matches styles.css dark media query)
const DARK_CSS_VARS = [
  '--sg-bg:#1e1e2e',
  '--sg-surface:#262637',
  '--sg-surface-raised:#2e2e42',
  '--sg-border:#3a3a52',
  '--sg-border-subtle:#32324a',
  '--sg-text:#cdd6f4',
  '--sg-text-dim:#8b8fad',
  '--sg-text-faint:#6c7086',
  '--sg-primary:#19ac5c',
  '--sg-primary-hover:#6ac74c',
  '--sg-danger:#f38ba8',
  '--sg-warning:#f9e2af',
  '--sg-accent:#92ce36',
  '--sg-avatar-bg:#2b3b35',
  '--sg-avatar-text:#dff0c4',
  '--sg-input-bg:#1a1a2a',
  '--sg-input-border:#3a3a52',
  '--sg-input-focus:#19ac5c',
].join(';');

// xterm.js canvas themes — Catppuccin Latte (light) and Mocha (dark)
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

export async function forceTheme(theme: 'light' | 'dark'): Promise<void> {
  const cssVars = theme === 'dark' ? DARK_CSS_VARS : LIGHT_CSS_VARS;
  const termBg = theme === 'dark' ? '#1e1e2e' : '#eff1f5';
  const styleContent = `:root{${cssVars}} [data-sg-terminal]{background-color:${termBg}!important}`;

  // Inject (or update) a forced-theme <style> element in the document head.
  await browser.execute((css: string) => {
    let el = document.getElementById('sg-forced-theme') as HTMLStyleElement | null;
    if (!el) {
      el = document.createElement('style');
      el.id = 'sg-forced-theme';
      document.head.appendChild(el);
    }
    el.textContent = css;
  }, styleContent);

  // Update any live xterm.js instances so the canvas reflects the new palette.
  const xtermThemeJson = JSON.stringify(
    theme === 'dark' ? DARK_XTERM_THEME : LIGHT_XTERM_THEME
  );
  await browser.execute((themeJson: string) => {
    type XtermEl = HTMLElement & {
      __xterm?: {
        options: { theme: unknown };
        rows: number;
        refresh(start: number, end: number): void;
      };
    };
    const parsed: unknown = JSON.parse(themeJson);
    const containers = document.querySelectorAll('[data-pty-id]');
    for (const el of Array.from(containers)) {
      const xtermEl = el as XtermEl;
      if (xtermEl.__xterm) {
        xtermEl.__xterm.options.theme = parsed;
        xtermEl.__xterm.refresh(0, xtermEl.__xterm.rows - 1);
      }
    }
  }, xtermThemeJson);

  // Give the canvas renderer and compositor time to finish the repaint.
  await browser.pause(300);
}

// ---------------------------------------------------------------------------
// Path redaction
// ---------------------------------------------------------------------------

/**
 * Walk all text nodes in the document and replace absolute filesystem paths
 * with canonical fake paths so screenshots don't expose real user directories.
 * Keeps the last two path segments for context. Idempotent.
 */
async function redactPaths(): Promise<void> {
  await browser.execute(() => {
    const FAKE_ABS_BASE = '~/Projects/my-project';
    const FAKE_HOME_BASE = '~/Projects';
    // Negative lookbehind: only replace '/' NOT preceded by '~' or a word char.
    const ABS_PATH = /(?<![~\w])\/[^\s"'<>]+(\/[^\s"'<>]+)+/g;
    const HOME_PATH = /~\/[^\s"'<>]+(\/[^\s"'<>]+)+/g;

    function fakeTail(match: string, base: string): string {
      const parts = match.split('/').filter(Boolean);
      if (parts.at(-1) === 'root') {
        return base + '/' + (parts.at(-2) ?? 'project');
      }
      return base + '/' + parts.slice(-2).join('/');
    }

    function replacePaths(text: string): string {
      return text
        .replace(ABS_PATH, m => fakeTail(m, FAKE_ABS_BASE))
        .replace(HOME_PATH, m => fakeTail(m, FAKE_HOME_BASE));
    }

    function walk(node: Node): void {
      if (node.nodeType === 3 /* TEXT_NODE */) {
        const replaced = replacePaths((node as Text).textContent ?? '');
        if (replaced !== node.textContent) node.textContent = replaced;
      } else {
        for (const child of Array.from(node.childNodes)) walk(child);
      }
    }
    walk(document.body);
  });
}

// ---------------------------------------------------------------------------
// UI settle helper
// ---------------------------------------------------------------------------

/**
 * Wait until there are no visible spinners or toast notifications,
 * and allow short CSS entrance animations to complete.
 */
async function waitForUiSettle(timeout = 5_000): Promise<void> {
  await browser.waitUntil(
    async () =>
      (await browser.execute(() => {
        const spinners = document.querySelectorAll('[data-testid="spinner"]');
        const toasts = document.querySelectorAll('[data-testid="toast"]');
        return spinners.length === 0 && toasts.length === 0;
      })) as boolean,
    { timeout, interval: 200 }
  );
  // Allow entrance animations (~0.3 s sg-fade-in, ~0.25 s sg-slide-up) to finish.
  await browser.pause(350);
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Capture the current viewport as a PNG, redact filesystem paths, and write
 * the file to the configured screenshot directory.
 *
 * @param name  Logical name, e.g. `'workspace/commit-graph'`. Slashes create
 *              subdirectories. Spaces and special characters are slugified.
 * @returns     Absolute path of the written PNG.
 */
/**
 * Inject fake macOS traffic-light dots via a <style> tag so CDP screenshots
 * look like a real native window. The style is removed after capture.
 *
 * Dots are vertically centred in the 38 px titlebar (`--sg-titlebar-height`).
 * Left position matches `trafficLightPosition: { x: 16, y: 12 }` in index.ts.
 *
 * Three dots are rendered using the `::before` box-shadow trick:
 *   dot 1 (close, red)    — the pseudo-element itself
 *   dot 2 (minimise, yel) — box-shadow at +20 px
 *   dot 3 (zoom, green)   — box-shadow at +40 px
 */
async function injectTrafficLights(): Promise<void> {
  // Traffic-light dots are macOS-specific; on Windows/Linux the app renders
  // its own window controls so no injection is needed.
  if (process.platform !== 'darwin') return;
  await browser.execute(() => {
    if (document.getElementById('sg-traffic-light-style')) return;
    const style = document.createElement('style');
    style.id = 'sg-traffic-light-style';
    style.textContent = `
      body::before {
        content: '';
        position: fixed;
        top: 13px;
        left: 10px;
        width: 12px;
        height: 12px;
        border-radius: 50%;
        background: #FF5F57;
        box-shadow:
          0 0 0 0.5px rgba(0,0,0,0.12),
          20px 0 0 #FEBC2E,
          20px 0 0 0.5px rgba(0,0,0,0.12),
          40px 0 0 #28C840,
          40px 0 0 0.5px rgba(0,0,0,0.12);
        z-index: 2147483647;
        pointer-events: none;
      }
    `;
    document.head.appendChild(style);
  });
}

async function removeTrafficLights(): Promise<void> {
  if (process.platform !== 'darwin') return;
  await browser.execute(() => {
    document.getElementById('sg-traffic-light-style')?.remove();
  });
}

export async function captureNamedScreenshot(name: string): Promise<string> {
  await waitForUiSettle();
  await redactPaths();
  await injectTrafficLights();

  const dir = resolveTargetDir();
  // Support '/' separators for sub-directory organisation.
  const filename = `${name.split('/').map(slug).join('/')}.png`;
  const outputPath = join(dir, filename);

  mkdirSync(dirname(outputPath), { recursive: true });

  // browser.takeScreenshot() returns a base64-encoded PNG string.
  const base64 = await browser.takeScreenshot();
  writeFileSync(outputPath, Buffer.from(base64, 'base64'));

  await removeTrafficLights();

  console.log(`[screenshot] Saved: ${outputPath}`);
  return outputPath;
}

/**
 * Capture both a light and dark variant of the current UI state.
 * Produces `<name>-light.png` and `<name>-dark.png`.
 * Restores light mode after both shots are taken.
 */
/**
 * Wait until browser.execute() succeeds, so we know the wdio-electron bridge
 * has re-acquired the renderer DevTools context (can go stale after screenshots
 * or window operations).
 */
async function waitForBridgeContext(timeout = 5_000): Promise<void> {
  await browser.waitUntil(
    async () => {
      try {
        await browser.execute(() => true);
        return true;
      } catch {
        return false;
      }
    },
    { timeout, interval: 400 }
  );
}

export async function captureScreenshotVariants(name: string): Promise<void> {
  await forceTheme('light');
  await browser.pause(150);
  await captureNamedScreenshot(`${name}-light`);

  // The wdio-electron bridge context ID can go stale briefly after a
  // takeScreenshot() CDP call. Wait until execute() works again.
  await waitForBridgeContext();
  await forceTheme('dark');
  await browser.pause(150);
  await captureNamedScreenshot(`${name}-dark`);

  await waitForBridgeContext();
  // Restore light as the default for subsequent interactions.
  await forceTheme('light');
}
