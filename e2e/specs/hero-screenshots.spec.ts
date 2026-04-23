import { test, expect } from '../fixtures';
import { createHeroMediaRepo } from '../helpers/benchmark-repos';
import { appendRepoFile, resetConfigDb, resetTestDirs } from '../helpers/fixtures';
import { captureNamedScreenshot } from '../helpers/screenshots';
import { createWorktreeViaUi, DEFAULT_UI_TIMEOUT, importRepoViaUi, openChangesTab, openHistoryTab, reloadToHome } from '../helpers/ui';

test.describe('Hero screenshots @screenshots', () => {
  test.skip(!process.env.CAPTURE_SCREENSHOTS, 'Set CAPTURE_SCREENSHOTS=1 to generate curated screenshots');

  test.beforeEach(async ({ tauriPage }) => {
    resetTestDirs();
    resetConfigDb();
    await reloadToHome(tauriPage);
  });

  test('captures canonical UI screenshots from the pinned hero repo', async ({ tauriPage }, testInfo) => {
    const repoPath = createHeroMediaRepo();
    await importRepoViaUi(tauriPage, repoPath);

    await captureNamedScreenshot(tauriPage, testInfo, 'hero-01-workspace-history');

    await createWorktreeViaUi(tauriPage, 'feature/hero-shot');
    await captureNamedScreenshot(tauriPage, testInfo, 'hero-02-worktree-list');

    await openHistoryTab(tauriPage);
    await tauriPage.getByTestId('commit-row').first().waitFor(DEFAULT_UI_TIMEOUT);
    await captureNamedScreenshot(tauriPage, testInfo, 'hero-03-commit-graph');

    const worktreeItem = tauriPage.locator('[data-testid="worktree-item"][data-branch="feature/hero-shot"]');
    const worktreePath = await worktreeItem.getAttribute('data-path') ?? (() => { throw new Error('worktree-item missing data-path'); })();
    appendRepoFile(worktreePath, 'src/lib/graph.ts', 'hero diff line');

    await openChangesTab(tauriPage);
    await tauriPage.getByTestId('unstaged-file').first().waitFor(DEFAULT_UI_TIMEOUT);
    await captureNamedScreenshot(tauriPage, testInfo, 'hero-04-diff-view');

    await openHistoryTab(tauriPage);
    const firstCommit = tauriPage.getByTestId('commit-row').first();
    await expect(firstCommit).toBeVisible();
    const box = await firstCommit.boundingBox();
    if (!box) throw new Error('Could not get bounding box for commit row');
    await tauriPage.mouse.click(box.x + 20, box.y + box.height / 2, { button: 'right' });
    await captureNamedScreenshot(tauriPage, testInfo, 'hero-05-context-menu');
  });
});