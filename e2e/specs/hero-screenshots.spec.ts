/**
 * Hero screenshots spec — generates the canonical marketing screenshots
 * used on the SproutGit website and promotional materials.
 *
 * Ported from old/e2e/specs/hero-screenshots.spec.ts (Tauri/Playwright).
 * Adapted to use WebdriverIO browser globals and the Electron API surface.
 *
 * ─── How to run ──────────────────────────────────────────────────────────────
 *   CAPTURE_SCREENSHOTS=1 npx wdio run wdio.conf.ts --spec specs/hero-screenshots.spec.ts
 *
 * Screenshots are written to e2e/test-results/screenshots/{mac|windows|linux}/ by default.
 * Override the base directory with SCREENSHOT_TARGET=<path> (platform subfolder is appended automatically).
 * ─────────────────────────────────────────────────────────────────────────────
 *
 * Shot list:
 *   workspace/commit-graph-light/dark  — history Graph tab with WT markers
 *   diff/changes-panel-light/dark      — Changes tab with a file selected
 *   context-menu/commit-light/dark     — right-click context menu on a commit row
 *   settings/preferences-light/dark    — settings page with anonymised identity
 *   terminal/grid-view-light/dark      — two PTY sessions in 2-column grid layout
 *   hooks/management-light/dark        — workspace hooks modal with seeded hooks
 */

import { spawnSync } from 'node:child_process';
import { appendFileSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { tmpdir } from 'node:os';
import { gotoHash } from '../helpers.js';
import { captureScreenshotVariants } from '../helpers/screenshots.js';

// ── Constants ─────────────────────────────────────────────────────────────────

const UI_TIMEOUT = 20_000;

// ── Git helpers ───────────────────────────────────────────────────────────────

const BASE_GIT_ENV = {
  GIT_AUTHOR_NAME: 'SproutGit Test',
  GIT_AUTHOR_EMAIL: 'test@sproutgit.test',
  GIT_COMMITTER_NAME: 'SproutGit Test',
  GIT_COMMITTER_EMAIL: 'test@sproutgit.test',
  GIT_TERMINAL_PROMPT: '0',
};

function gitEnv(sequence: number) {
  // Produce deterministic but organic-looking commit timestamps spread over
  // the past ~90 days. Sequence 0 = oldest, higher = more recent.
  const daysAgo = 90 * (1 - sequence / 42);
  const ms = Date.now() - daysAgo * 86_400_000;
  // Working-hours jitter: pin to 9:00 + (sequence % 8) hours
  const d = new Date(ms);
  d.setHours(9 + (sequence % 8), (sequence * 7) % 60, 0, 0);
  const iso = d.toISOString();
  return {
    ...BASE_GIT_ENV,
    GIT_AUTHOR_DATE: iso,
    GIT_COMMITTER_DATE: iso,
  };
}

function runGit(cwd: string, args: string[], env: Record<string, string> = {}) {
  const clean = { ...process.env };
  delete clean['GIT_DIR'];
  delete clean['GIT_WORK_TREE'];
  delete clean['GIT_INDEX_FILE'];
  delete clean['GIT_COMMON_DIR'];
  const result = spawnSync('git', args, {
    cwd,
    env: { ...clean, ...BASE_GIT_ENV, ...env },
    stdio: 'pipe',
    encoding: 'utf8',
  });
  if (result.status !== 0) {
    throw new Error(
      `git ${args.join(' ')} failed (exit ${result.status ?? 'null'}):\n${result.stderr || result.error?.message || '(no output)'}`
    );
  }
}

function writeFile(repoPath: string, relativePath: string, content: string) {
  const abs = join(repoPath, relativePath);
  mkdirSync(dirname(abs), { recursive: true });
  writeFileSync(abs, content);
}

function appendFile(repoPath: string, relativePath: string, line: string) {
  appendFileSync(join(repoPath, relativePath), `${line}\n`);
}

function commitAll(repoPath: string, message: string, seq: number) {
  runGit(repoPath, ['add', '--all'], gitEnv(seq));
  runGit(repoPath, ['commit', '-m', message], gitEnv(seq));
}

function checkout(repoPath: string, ref: string, create = false) {
  runGit(repoPath, create ? ['checkout', '-b', ref] : ['checkout', ref]);
}

function mergeNoFf(repoPath: string, ref: string, message: string, seq: number) {
  runGit(repoPath, ['merge', '--no-ff', ref, '-m', message], gitEnv(seq));
}

function createAnnotatedTag(
  repoPath: string,
  tag: string,
  message: string,
  seq: number
) {
  runGit(repoPath, ['tag', '-a', tag, '-m', message], gitEnv(seq));
}

// ── Hero repo factory ─────────────────────────────────────────────────────────

/**
 * Create a rich git repository that looks like a real project — multiple
 * merged feature branches, tags, and open branches. Returns the repo path.
 */
function createHeroRepo(): string {
  const repoPath = mkdtempSync(join(tmpdir(), 'sg-hero-repo-'));

  runGit(repoPath, ['init', '-b', 'main']);
  runGit(repoPath, ['config', 'user.email', 'test@sproutgit.test']);
  runGit(repoPath, ['config', 'user.name', 'SproutGit Test']);

  // ── Initial files ───────────────────────────────────────────────────────────
  writeFile(repoPath, 'README.md', '# Axiom\n\nA modern TypeScript application framework.\n');
  writeFile(repoPath, 'src/index.ts', 'export { createApp } from "./app";\n');
  writeFile(repoPath, 'src/app.ts', 'export function createApp() { return { version: "0.1.0" }; }\n');
  writeFile(repoPath, 'src/auth/index.ts', 'export { authenticate } from "./jwt";\n');
  writeFile(repoPath, 'src/auth/jwt.ts', 'export function authenticate(token: string) { return !!token; }\n');
  writeFile(repoPath, 'src/api/client.ts', 'export const BASE_URL = "https://api.axiom.dev";\n');
  writeFile(repoPath, 'src/ui/dashboard.tsx', 'export function Dashboard() { return <div>Dashboard</div>; }\n');
  writeFile(repoPath, 'src/config.ts', 'export const config = { env: "development", debug: true };\n');
  writeFile(repoPath, 'tests/smoke.test.ts', 'describe("smoke", () => { it("works", () => {}); });\n');
  writeFile(
    repoPath,
    '.github/workflows/ci.yml',
    'name: CI\non: [push, pull_request]\njobs:\n  test:\n    runs-on: ubuntu-latest\n    steps: []\n'
  );
  commitAll(repoPath, 'Initial commit', 0);
  writeFile(repoPath, 'package.json', '{"name":"axiom","version":"0.1.0","private":true}\n');
  writeFile(repoPath, 'tsconfig.json', '{"compilerOptions":{"strict":true,"target":"ES2022","module":"NodeNext"}}\n');
  commitAll(repoPath, 'Add project scaffolding', 1);

  // ── feature/auth ────────────────────────────────────────────────────────────
  checkout(repoPath, 'feature/auth', true);
  writeFile(
    repoPath,
    'src/auth/jwt.ts',
    'export function authenticate(token: string) {\n' +
      '  if (!token) throw new Error("Missing token");\n' +
      '  return { valid: true, sub: "user:1" };\n' +
      '}\n'
  );
  commitAll(repoPath, 'feat(auth): add JWT validation with error handling', 2);
  writeFile(repoPath, 'src/auth/refresh.ts', 'export function refreshToken(token: string) { return token; }\n');
  commitAll(repoPath, 'feat(auth): add refresh token support', 3);
  writeFile(repoPath, 'tests/auth.test.ts', 'describe("auth", () => { it("validates JWT", () => {}); });\n');
  commitAll(repoPath, 'test(auth): add JWT unit tests', 4);
  checkout(repoPath, 'main');
  mergeNoFf(repoPath, 'feature/auth', 'Merge feature/auth: JWT validation', 20);

  // ── feature/dashboard ───────────────────────────────────────────────────────
  checkout(repoPath, 'feature/dashboard', true);
  writeFile(
    repoPath,
    'src/ui/dashboard.tsx',
    'export function Dashboard() {\n  return (\n    <div className="dashboard"><h1>Dashboard</h1><MetricsPanel /></div>\n  );\n}\n'
  );
  commitAll(repoPath, 'feat(ui): redesign dashboard with metrics panel', 5);
  writeFile(repoPath, 'src/ui/components/MetricsPanel.tsx', 'export function MetricsPanel() { return <div className="metrics" />; }\n');
  commitAll(repoPath, 'feat(ui): add MetricsPanel component', 6);
  writeFile(repoPath, 'tests/dashboard.test.tsx', 'describe("Dashboard", () => { it("renders metrics", () => {}); });\n');
  commitAll(repoPath, 'test(ui): add dashboard snapshot tests', 8);
  checkout(repoPath, 'main');
  mergeNoFf(repoPath, 'feature/dashboard', 'Merge feature/dashboard: redesign', 21);

  // ── hotfix/token-expiry ─────────────────────────────────────────────────────
  checkout(repoPath, 'hotfix/token-expiry', true);
  writeFile(
    repoPath,
    'src/auth/jwt.ts',
    'export function authenticate(token: string) {\n' +
      '  if (!token) throw new Error("Missing token");\n' +
      '  if (isExpired(token)) throw new Error("Token expired");\n' +
      '  return { valid: true, sub: "user:1" };\n' +
      '}\nexport function isExpired(_t: string) { return false; }\n'
  );
  commitAll(repoPath, 'fix: handle expired JWT tokens gracefully', 9);
  checkout(repoPath, 'main');
  mergeNoFf(repoPath, 'hotfix/token-expiry', 'Merge hotfix/token-expiry: expired JWT patch', 22);

  // ── release/1.0 tag ─────────────────────────────────────────────────────────
  checkout(repoPath, 'release/1.0', true);
  writeFile(repoPath, 'src/index.ts', 'export { createApp } from "./app";\nexport const VERSION = "1.0.0";\n');
  commitAll(repoPath, 'chore: bump version to 1.0.0', 33);
  createAnnotatedTag(repoPath, 'v1.0.0', 'Release 1.0.0 — stable auth and dashboard', 34);
  checkout(repoPath, 'main');

  // ── feature/notifications (open) ────────────────────────────────────────────
  checkout(repoPath, 'feature/notifications', true);
  writeFile(repoPath, 'src/notifications/index.ts', 'export function notify(msg: string) { console.log(msg); }\n');
  commitAll(repoPath, 'feat: add push notification service', 14);
  writeFile(repoPath, 'src/notifications/preferences.ts', 'export const defaultPrefs = { email: true, push: true };\n');
  commitAll(repoPath, 'feat: add notification preference model', 15);
  checkout(repoPath, 'main');
  mergeNoFf(repoPath, 'feature/notifications', 'Merge feature/notifications', 23);

  // ── post-merge main commits ──────────────────────────────────────────────────
  writeFile(repoPath, 'docs/CHANGELOG.md', '# Changelog\n\n## v1.1.0\n- Push notifications\n');
  commitAll(repoPath, 'docs: update CHANGELOG for v1.1.0', 35);
  createAnnotatedTag(repoPath, 'v1.1.0', 'Release 1.1.0', 37);

  // ── feature/api-v2 (open — not merged) ──────────────────────────────────────
  checkout(repoPath, 'feature/api-v2', true);
  writeFile(repoPath, 'src/api/v2/client.ts', 'export const API_V2 = "https://api.axiom.dev/v2";\n');
  commitAll(repoPath, 'feat(api): scaffold v2 client', 38);
  writeFile(repoPath, 'src/api/v2/auth.ts', 'export function v2Auth() {}\n');
  commitAll(repoPath, 'feat(api): add v2 auth endpoint', 39);
  checkout(repoPath, 'main');

  return repoPath;
}

// ── UI helpers ────────────────────────────────────────────────────────────────

/** Navigate to the workspace view for a given repo path. */
async function openWorkspace(repoPath: string): Promise<void> {
  await gotoHash(`/workspace?path=${encodeURIComponent(repoPath)}`);
  // Wait for the Graph tab to confirm the workspace loaded.
  await $('//*[contains(@class,"sg-tab") and contains(.,"Graph")]').waitForDisplayed({
    timeout: UI_TIMEOUT,
  });
}

/** Click the Graph tab and wait for at least one commit row to render. */
async function openGraphTab(): Promise<void> {
  await $('//*[contains(@class,"sg-tab") and contains(.,"Graph")]').click();
  await $('[data-testid^="commit-row-"]').waitForDisplayed({ timeout: UI_TIMEOUT });
}

/** Click the Changes tab. */
async function openChangesTab(): Promise<void> {
  const tab = $('//*[contains(@class,"sg-tab") and contains(.,"Changes")]');
  await tab.waitForDisplayed({ timeout: UI_TIMEOUT });
  await tab.click();
}

/** Click the Terminal tab, optionally opening a new PTY if none is open. */
async function openTerminalTab(): Promise<void> {
  const tab = $('//*[contains(@class,"sg-tab") and contains(.,"Terminal")]');
  await tab.waitForDisplayed({ timeout: UI_TIMEOUT });
  await tab.click();
}

/**
 * Create a new worktree for `branchName` via the window.api IPC call,
 * bypassing the UI dialog for speed.
 */
/**
 * Pre-create worktrees using the git CLI in the test process so they are
 * already present when `openWorkspace()` is called. The initial `listWorktrees`
 * query picks them up without any IPC workaround.
 */
function createWorktreesBeforeOpen(repoPath: string, branches: string[]): void {
  const worktreesDir = join(repoPath, '.sproutgit', 'worktrees');
  mkdirSync(worktreesDir, { recursive: true });
  for (const branch of branches) {
    // Use a flat path (slashes → underscores) so the filesystem path is safe.
    const wtPath = join(worktreesDir, branch.replace(/\//g, '_'));
    runGit(repoPath, ['worktree', 'add', '-b', branch, wtPath, 'main']);
  }
}

// ── Test suite ────────────────────────────────────────────────────────────────

describe('Hero screenshots @screenshots', () => {
  // Skip the entire suite unless explicitly requested.
  before(function () {
    if (!process.env['CAPTURE_SCREENSHOTS']) {
      this.skip();
    }
  });

  let repoPath: string;

  before(async () => {
    repoPath = createHeroRepo();
    // Pre-create worktrees so they are visible immediately when the workspace opens.
    createWorktreesBeforeOpen(repoPath, [
      'feature/settings-redesign',
      'fix/performance-regression',
      'chore/update-dependencies',
    ]);
  });

  after(() => {
    // maxRetries/retryDelay cover the Windows teardown-timing gap (see
    // cleanupRepo's doc comment in helpers.ts) between closing handles and
    // the OS actually releasing them.
    if (repoPath) rmSync(repoPath, { recursive: true, force: true, maxRetries: 20, retryDelay: 250 });
  });

  it('captures canonical UI screenshots from the hero repo', async function () {
    await openWorkspace(repoPath);

    // Worktrees were pre-created before the workspace opened; wait for the sidebar to render them.
    await $('[data-testid="worktree-item"]').waitForDisplayed({ timeout: UI_TIMEOUT });

    // ── Shot 1: workspace/commit-graph — Graph tab with worktree markers ──────
    await openGraphTab();
    await browser.pause(500); // let graph settle
    await captureScreenshotVariants('workspace/commit-graph');

    // ── Shot 2: diff/changes-panel — Changes tab with staged/unstaged files ───

    // Switch to the feature/settings-redesign worktree and write some changes.
    const settingsWtEl = $('[data-testid="worktree-item"][data-branch="feature/settings-redesign"]');
    const settingsPath = await settingsWtEl.getAttribute('data-path') ?? '';
    if (!settingsPath) {
      throw new Error('worktree-item missing data-path for feature/settings-redesign');
    }

    writeFile(settingsPath, 'src/ui/settings/index.tsx',
      'export function SettingsPage() {\n  return (\n    <div className="settings-page"><h1>Settings</h1><ThemeSection /></div>\n  );\n}\n');
    appendFile(settingsPath, 'src/config.ts', '// updated by settings feature');
    writeFile(settingsPath, 'src/ui/settings/theme.tsx',
      'export function ThemeSection() { return <section>Theme: <select><option>Auto</option></select></section>; }\n');

    await settingsWtEl.click();
    await openChangesTab();

    const unstagedRow = $('[data-testid="staging-unstaged-file-row"]');
    await unstagedRow.waitForDisplayed({ timeout: UI_TIMEOUT });
    await unstagedRow.click();

    // Give the diff panel time to load the file diff.
    await browser.pause(600);
    await captureScreenshotVariants('diff/changes-panel');

    // ── Shot 3: context-menu/commit — right-click on a commit row ─────────────
    await openGraphTab();
    await $('[data-testid^="commit-row-"]').waitForDisplayed({ timeout: UI_TIMEOUT });

    // Dispatch a contextmenu event directly on the 4th row (0-indexed = row 3).
    await browser.execute(() => {
      const rows = document.querySelectorAll('[class~="commit-row"]');
      const row = rows[3] ?? rows[rows.length - 1] as Element | undefined;
      if (!row) return;
      const rect = row.getBoundingClientRect();
      const x = rect.left + Math.min(300, rect.width * 0.4);
      const y = rect.top + rect.height / 2;
      row.dispatchEvent(
        new MouseEvent('contextmenu', { bubbles: true, cancelable: true, clientX: x, clientY: y })
      );
    });

    // Wait for the context menu portal to appear.
    const ctxMenu = $('[data-testid="context-menu"]');
    if (await ctxMenu.isDisplayed().catch(() => false)) {
      await captureScreenshotVariants('context-menu/commit-history');
      // Dismiss before proceeding.
      await browser.execute(() => document.body.click());
      await browser.pause(200);
    } else {
      // Fall back to a graph shot (no context menu visible) — still capture both themes.
      await captureScreenshotVariants('context-menu/commit-history');
    }

    // ── Shot 4: settings/preferences — settings page with anonymised identity ─
    // Dismiss any open overlay/dialog before navigating to settings.
    await browser.keys(['Escape']);
    await browser.pause(300);
    // If a fixed overlay is still blocking, click the centre of the screen to dismiss.
    const hasOverlay = await browser.execute(() =>
      !!document.querySelector('div[style*="position: fixed"][style*="inset: 0"]')
    );
    if (hasOverlay) {
      await browser.execute(() => {
        const el = document.querySelector<HTMLElement>('div[style*="position: fixed"][style*="inset: 0"]');
        el?.click();
      });
      await browser.pause(200);
    }
    // Navigate to settings via the title-bar Settings button.
    const settingsBtn = $('[title="Settings"]');
    await settingsBtn.waitForDisplayed({ timeout: UI_TIMEOUT });
    await settingsBtn.click();
    await $('[data-testid="settings-page"]').waitForDisplayed({ timeout: UI_TIMEOUT });

    // Let async data (git identity, etc.) finish loading.
    await browser.pause(800);

    // Anonymise identity-revealing text nodes.
    await browser.execute(() => {
      function walk(node: Node): void {
        if (node.nodeType === 3) {
          let t = (node as Text).textContent ?? '';
          // Email addresses
          t = t.replace(/[a-zA-Z0-9._%+\-]+@[a-zA-Z0-9.\-]+\.[a-zA-Z]{2,}/g, 'alex.chen@example.com');
          // GitHub @handles
          t = t.replace(/@[a-zA-Z0-9_\-]+/g, '@alex-chen');
          // Full name before a separator
          t = t.replace(/^[^·@\n]{2,40}(?=\s*·)/, 'Alex Chen');
          if (t !== node.textContent) node.textContent = t;
        } else {
          for (const child of Array.from(node.childNodes)) walk(child);
        }
      }
      walk(document.body);
    });

    await captureScreenshotVariants('settings/preferences');

    // Navigate directly back to the workspace (reuse the same helper as the
    // initial openWorkspace call; waits for the Graph tab to confirm load).
    await openWorkspace(repoPath);

    // ── Shot 5: terminal/grid-view — two PTY sessions in 2-column layout ──────
    await browser.pause(500); // brief settle after navigation back to workspace
    await openTerminalTab();

    // Wait for the first PTY container to get its ID assigned.
    await browser.waitUntil(
      async () =>
        (await browser.execute(() => {
          return document.querySelector('[data-pty-id]:not([data-pty-id=""])') !== null;
        })) as boolean,
      { timeout: UI_TIMEOUT, interval: 200 }
    );

    // Open a second terminal session.
    const addTermBtn = $('[data-testid="btn-add-terminal"]');
    await addTermBtn.waitForDisplayed({ timeout: UI_TIMEOUT });
    await addTermBtn.click();

    // If a shell picker appeared, choose the first option.
    const shellOpt = $('[data-testid="terminal-shell-option"]');
    if (await shellOpt.isDisplayed().catch(() => false)) {
      await shellOpt.click();
    }

    // Wait until two PTY panels are active.
    await browser.waitUntil(
      async () =>
        (await browser.execute(() => {
          return (
            document.querySelectorAll('[data-pty-id]:not([data-pty-id=""])').length >= 2
          );
        })) as boolean,
      { timeout: UI_TIMEOUT, interval: 200 }
    );

    // Switch to 2-column grid layout.
    const gridBtn = $('[title="Grid (2-column)"]');
    if (await gridBtn.isDisplayed().catch(() => false)) {
      await gridBtn.click();
      await browser.pause(300);
    }

    // Send a meaningful git command to each PTY via window.api.
    const ptyIds = (await browser.execute(() => {
      return Array.from(
        document.querySelectorAll('[data-pty-id]:not([data-pty-id=""])')
      ).map(el => el.getAttribute('data-pty-id') ?? '');
    })) as string[];

    const commands = [
      'git log --oneline --graph --all --decorate -8\r',
      'git diff --stat HEAD~1\r',
    ];

    for (let i = 0; i < ptyIds.length; i++) {
      const id = ptyIds[i];
      const cmd = commands[i % commands.length];
      if (id) {
        await browser.execute(
          (ptyId: string, data: string) => {
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            void (window as any).api?.writeTerminal(ptyId, data);
          },
          id,
          cmd
        );
        // Stagger so output doesn't interleave.
        await browser.pause(500);
      }
    }

    // Give terminals time to render their output.
    await browser.pause(2_000);
    await captureScreenshotVariants('terminal/grid-view');

    // ── Shot 6: hooks/management — workspace hooks modal with seeded hooks ──
    // Seed three representative hooks via the IPC API.
    await browser.execute(
      async (workspacePath: string) => {
        const api = (window as unknown as { api: Record<string, (...args: unknown[]) => Promise<unknown>> }).api;
        await api['createHook']({
          workspacePath,
          id: 'hero-hook-setup',
          name: 'Set up dev environment',
          scope: 'workspace',
          trigger: 'after_worktree_create',
          executionTarget: 'terminal_tab',
          shell: 'sh',
          script: 'pnpm install && pnpm build',
          enabled: true,
        });
        await api['createHook']({
          workspacePath,
          id: 'hero-hook-lint',
          name: 'Run linter & type check',
          scope: 'workspace',
          trigger: 'after_worktree_create',
          executionTarget: 'terminal_tab',
          shell: 'sh',
          script: 'pnpm lint && pnpm typecheck',
          enabled: true,
        });
        await api['createHook']({
          workspacePath,
          id: 'hero-hook-clean',
          name: 'Clean build cache',
          scope: 'workspace',
          trigger: 'before_worktree_remove',
          executionTarget: 'terminal_tab',
          shell: 'sh',
          script: 'rm -rf .turbo dist out',
          enabled: true,
        });
      },
      repoPath
    );

    // Open the hooks modal via the sidebar toolbar button.
    const hooksBtn = $('[title="Workspace hooks"]');
    await hooksBtn.waitForDisplayed({ timeout: UI_TIMEOUT });
    await hooksBtn.click();

    // Wait for the modal to appear.
    const hooksModal = $('[aria-label="Manage hooks"]');
    await hooksModal.waitForDisplayed({ timeout: UI_TIMEOUT });

    // Wait until hook rows are rendered (hooks loaded from DB).
    await browser.waitUntil(
      async () =>
        (await browser.execute(() => {
          // Hook list items are rendered as divs with a font-medium child
          // inside the left panel of the modal.
          const modal = document.querySelector('[aria-label="Manage hooks"]');
          if (!modal) return false;
          return modal.querySelectorAll('[class*="font-medium"]').length >= 3;
        })) as boolean,
      { timeout: UI_TIMEOUT, interval: 200 }
    );
    // Let entrance animations finish.
    await browser.pause(400);

    await captureScreenshotVariants('hooks/management');

    // Close the modal.
    await browser.execute(() => { document.body.click(); });
  });
});
