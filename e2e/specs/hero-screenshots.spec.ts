import { test } from '../fixtures';
import { createHeroMediaRepo } from '../helpers/benchmark-repos';
import { appendRepoFile, resetConfigDb, resetTestDirs, writeRepoFile } from '../helpers/fixtures';
import { captureScreenshotVariants, resizeWindowForScreenshot } from '../helpers/screenshots';
import {
  createWorktreeViaUi,
  DEFAULT_UI_TIMEOUT,
  importRepoViaUi,
  openChangesTab,
  openHistoryTab,
  reloadToHome,
} from '../helpers/ui';

test.describe('Hero screenshots @screenshots', () => {
  test.skip(
    !process.env.CAPTURE_SCREENSHOTS,
    'Set CAPTURE_SCREENSHOTS=1 to generate curated screenshots'
  );

  test.beforeEach(async ({ tauriPage }) => {
    resetTestDirs();
    resetConfigDb();
    await reloadToHome(tauriPage);
  });

  test('captures canonical UI screenshots from the pinned hero repo', async ({
    tauriPage,
  }, testInfo) => {
    // Compact window so screenshots have less whitespace and look tighter.
    await resizeWindowForScreenshot(tauriPage, 960, 620);

    const repoPath = createHeroMediaRepo();
    await importRepoViaUi(tauriPage, repoPath);

    // ── Create three worktrees so the sidebar looks rich ─────────────────────
    await createWorktreeViaUi(tauriPage, 'feature/settings-redesign');
    await createWorktreeViaUi(tauriPage, 'fix/performance-regression');
    await createWorktreeViaUi(tauriPage, 'chore/update-dependencies');

    // ── Shot 1: workspace/commit-graph — history tab with WT markers ──────────
    await openHistoryTab(tauriPage);
    await tauriPage.getByTestId('commit-row').first().waitFor(DEFAULT_UI_TIMEOUT);
    await captureScreenshotVariants(tauriPage, testInfo, 'workspace/commit-graph');

    // ── Shot 2: diff/changes-panel — changes tab with a file selected ─────────
    const settingsWt = tauriPage.locator(
      '[data-testid="worktree-item"][data-branch="feature/settings-redesign"]'
    );
    const settingsPath =
      (await settingsWt.getAttribute('data-path')) ??
      (() => {
        throw new Error('worktree-item missing data-path');
      })();

    writeRepoFile(
      settingsPath,
      'src/ui/settings/index.tsx',
      'export function SettingsPage() {\n' +
        '  return (\n' +
        '    <div className="settings-page">\n' +
        '      <h1>Settings</h1>\n' +
        '      <ThemeSection />\n' +
        '      <NotificationsSection />\n' +
        '    </div>\n' +
        '  );\n' +
        '}\n'
    );
    appendRepoFile(settingsPath, 'src/config.ts', '// updated by settings feature');
    writeRepoFile(
      settingsPath,
      'src/ui/settings/theme.tsx',
      'export function ThemeSection() {\n' +
        '  return <section>Theme: <select><option>Auto</option></select></section>;\n' +
        '}\n'
    );
    writeRepoFile(
      settingsPath,
      'src/ui/settings/notifications.tsx',
      'export function NotificationsSection() {\n' +
        '  return <section>Notifications: <input type="checkbox" defaultChecked /></section>;\n' +
        '}\n'
    );
    appendRepoFile(
      settingsPath,
      'tests/settings.test.ts',
      '  it("renders theme section", () => {});'
    );

    await settingsWt.click();
    await openChangesTab(tauriPage);
    await tauriPage.getByTestId('unstaged-file').first().waitFor(DEFAULT_UI_TIMEOUT);
    await tauriPage.getByTestId('unstaged-file').first().click();
    await tauriPage.getByTestId('diff-panel-header').waitFor(DEFAULT_UI_TIMEOUT);
    await captureScreenshotVariants(tauriPage, testInfo, 'diff/changes-panel');

    // ── Shot 3: context-menu/commit-history — right-click on a commit ─────────
    await openHistoryTab(tauriPage);
    await tauriPage.getByTestId('commit-row').first().waitFor(DEFAULT_UI_TIMEOUT);

    const rows = tauriPage.locator('[data-testid="commit-row"]');
    const targetRow = rows.nth(3);
    await targetRow.waitFor(DEFAULT_UI_TIMEOUT);

    // Dispatch a contextmenu event directly on the element. TauriPage mouse.click
    // with button:'right' does not reliably produce a contextmenu DOM event.
    await tauriPage.evaluate(`(() => {
      const rows = document.querySelectorAll('[data-testid="commit-row"]');
      const row = rows[3] ?? rows[rows.length - 1];
      if (!row) return;
      const rect = row.getBoundingClientRect();
      const x = rect.left + Math.min(300, rect.width * 0.4);
      const y = rect.top + rect.height / 2;
      row.dispatchEvent(new MouseEvent('contextmenu', {
        bubbles: true, cancelable: true, clientX: x, clientY: y,
      }));
    })()`);

    await tauriPage.getByTestId('context-menu').waitFor(DEFAULT_UI_TIMEOUT);
    await captureScreenshotVariants(tauriPage, testInfo, 'context-menu/commit-history');

    // Dismiss context menu before continuing.
    await tauriPage.evaluate(`document.body.click()`);

    // ── Shot 4: settings/preferences — settings page with anonymised data ─────
    await tauriPage.getByTestId('btn-open-settings').click();
    await tauriPage.getByTestId('settings-page').waitFor(DEFAULT_UI_TIMEOUT);
    // Let all async data finish loading.
    await new Promise(r => setTimeout(r, 800));

    // Anonymise all identity-revealing text nodes in the settings page.
    await tauriPage.evaluate(`(() => {
      // Replace git author identity (shown as "Name · email@example.com")
      const walk = (node) => {
        if (node.nodeType === 3) {
          let t = node.textContent ?? '';
          // email addresses
          t = t.replace(/[a-zA-Z0-9._%+\\-]+@[a-zA-Z0-9.\\-]+\\.[a-zA-Z]{2,}/g, 'alex.chen@example.com');
          // GitHub usernames that look like "@handle"
          t = t.replace(/@[a-zA-Z0-9_\\-]+/g, '@alex-chen');
          // Full name adjacent to a separator (e.g. "Liam · liam@…")
          t = t.replace(/^[^·@\\n]{2,40}(?=\\s*·)/, 'Alex Chen');
          if (t !== node.textContent) node.textContent = t;
        } else {
          for (const child of Array.from(node.childNodes)) walk(child);
        }
      };
      walk(document.body);
    })()`);

    await captureScreenshotVariants(tauriPage, testInfo, 'settings/preferences');

    // Navigate back to workspace (click the back button in the settings header).
    const backBtn = tauriPage.locator('header button').first();
    await backBtn.click();
    await tauriPage.getByTestId('worktree-list').waitFor(DEFAULT_UI_TIMEOUT);

    // ── Shot 5: terminal/grid-view — two sessions in grid layout ─────────────
    await tauriPage.getByTestId('tab-terminal').click();

    // Wait for the first PTY to be assigned (data-pty-id populated).
    await tauriPage.waitForFunction(
      `(() => document.querySelector('[data-pty-id]:not([data-pty-id=""])') !== null)()`,
      DEFAULT_UI_TIMEOUT
    );

    // Add a second terminal session.
    const addBtn = tauriPage.getByTestId('btn-add-terminal');
    await addBtn.click();
    // If a shell picker appeared, choose the first option.
    const shellOption = tauriPage.getByTestId('terminal-shell-option');
    const shellMenuVisible = await shellOption
      .first()
      .isVisible()
      .catch(() => false);
    if (shellMenuVisible) {
      await shellOption.first().click();
    }

    // Wait until two PTY panels exist.
    await tauriPage.waitForFunction(
      `(() => document.querySelectorAll('[data-pty-id]:not([data-pty-id=""])').length >= 2)()`,
      DEFAULT_UI_TIMEOUT
    );

    // Switch to grid layout (2-column).
    await tauriPage.locator('[title="Grid (2-column)"]').click();
    await new Promise(r => setTimeout(r, 300));

    // Collect all live PTY IDs and send a fun command to each.
    const ptyIds: string[] = await tauriPage.evaluate(`
      Array.from(document.querySelectorAll('[data-pty-id]:not([data-pty-id=""])')).map(el => el.getAttribute('data-pty-id'))
    `);

    const commands = [
      'git log --oneline --graph --all --decorate -8\r',
      'git diff --stat HEAD~1\r',
    ];
    for (let i = 0; i < ptyIds.length; i++) {
      const ptyId = ptyIds[i];
      const cmd = commands[i % commands.length];
      await tauriPage.evaluate(
        `window.__TAURI_INTERNALS__.invoke('terminal_input', { ptyId: ${JSON.stringify(ptyId)}, data: ${JSON.stringify(cmd)} })`
      );
      // Stagger sends so output doesn't interleave.
      await new Promise(r => setTimeout(r, 500));
    }

    // Give terminals time to render their output.
    await new Promise(r => setTimeout(r, 2000));
    await captureScreenshotVariants(tauriPage, testInfo, 'terminal/grid-view');
  });
});
