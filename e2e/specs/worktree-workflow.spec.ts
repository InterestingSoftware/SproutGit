import { test, expect } from '../fixtures';
import {
  createTestRepo,
  querySqlite,
  resetConfigDb,
  resetTestDirs,
  runGit,
} from '../helpers/fixtures';
import {
  createWorktreeViaUi,
  DEFAULT_UI_TIMEOUT,
  importRepoViaUi,
  reloadToHome,
} from '../helpers/ui';
import { dirname, join } from 'node:path';

test.describe('Worktree workflow', () => {
  test.beforeEach(async ({ tauriPage }) => {
    resetTestDirs();
    resetConfigDb();
    await reloadToHome(tauriPage);
  });

  test('creates, switches, and deletes managed worktrees', async ({ tauriPage }) => {
    const repoPath = createTestRepo('worktree-test', {
      extraCommits: 2,
      branches: ['develop'],
    });

    await importRepoViaUi(tauriPage, repoPath);
    await createWorktreeViaUi(tauriPage, 'feature/e2e-alpha');
    await createWorktreeViaUi(tauriPage, 'feature/e2e-beta');

    const alphaItem = tauriPage.locator(
      '[data-testid="worktree-item"][data-branch="feature/e2e-alpha"]'
    );
    const betaItem = tauriPage.locator(
      '[data-testid="worktree-item"][data-branch="feature/e2e-beta"]'
    );

    await expect(alphaItem).toBeVisible();
    await expect(betaItem).toBeVisible();

    // Verify git state: both worktrees are registered in git
    const alphaPath =
      (await alphaItem.getAttribute('data-path')) ??
      (() => {
        throw new Error('alpha worktree-item missing data-path');
      })();
    const gitRoot = join(dirname(dirname(alphaPath)), 'root');
    const worktreeList = runGit(gitRoot, ['worktree', 'list', '--porcelain']);
    expect(worktreeList).toContain('feature/e2e-alpha');
    expect(worktreeList).toContain('feature/e2e-beta');

    await alphaItem.click();
    await expect(alphaItem).toBeVisible();

    await betaItem.click();
    await expect(betaItem).toBeVisible();

    await tauriPage.evaluate(`(() => {
      const button = document.querySelector('[data-testid="worktree-item"][data-branch="feature/e2e-alpha"] [data-testid="btn-delete-worktree"]');
      if (!(button instanceof HTMLElement)) {
        throw new Error('delete worktree button not found for feature/e2e-alpha');
      }
      button.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
    })()`);

    await tauriPage.getByTestId('confirm-dialog').waitFor(DEFAULT_UI_TIMEOUT);
    await tauriPage.getByTestId('confirm-dialog-confirm').click();

    await tauriPage.waitForFunction(
      `!document.querySelector('[data-testid="worktree-item"][data-branch="feature/e2e-alpha"]')`,
      DEFAULT_UI_TIMEOUT
    );
    await expect(betaItem).toBeVisible();

    // Verify git state: alpha worktree is gone, beta worktree still exists
    const worktreeListAfter = runGit(gitRoot, ['worktree', 'list', '--porcelain']);
    expect(worktreeListAfter).not.toContain('feature/e2e-alpha');
    expect(worktreeListAfter).toContain('feature/e2e-beta');

    // SQLite assertion: state.db meta table was initialized for this workspace
    const stateDbPath = join(dirname(dirname(alphaPath)), '.sproutgit', 'state.db');
    const metaRows = querySqlite(
      stateDbPath,
      `SELECT value FROM meta WHERE key = 'workspace_path'`
    );
    expect(metaRows.length).toBe(1);
    expect(metaRows[0]?.[0]).toContain('worktree-test-workspace');
  });
});
