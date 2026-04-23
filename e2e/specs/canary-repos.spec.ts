import { test, expect } from '../fixtures';
import { CANARY_REPOS, materializeCanaryRepo } from '../helpers/benchmark-repos';
import { resetConfigDb, resetTestDirs } from '../helpers/fixtures';
import { importRepoViaUi, reloadToHome } from '../helpers/ui';

test.describe('Canary repositories @canary', () => {
  test.skip(!process.env.RUN_CANARY, 'Set RUN_CANARY=1 to run non-blocking canary repository checks');

  test.beforeEach(async ({ tauriPage }) => {
    resetTestDirs();
    resetConfigDb();
    await reloadToHome(tauriPage);
  });

  for (const canary of CANARY_REPOS) {
    test(`imports ${canary.name} and renders the workspace shell`, async ({ tauriPage }) => {
      const repoPath = materializeCanaryRepo(canary);
      await importRepoViaUi(tauriPage, repoPath);
      await expect(tauriPage.getByTestId('btn-back-projects')).toBeVisible();
      await expect(tauriPage.getByTestId('worktree-list')).toBeVisible();
      await expect(tauriPage.getByTestId('input-new-branch')).toBeVisible();
    });
  }
});