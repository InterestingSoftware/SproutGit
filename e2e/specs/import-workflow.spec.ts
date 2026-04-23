import { basename, dirname, join } from 'node:path';
import { test, expect } from '../fixtures';
import { createTestRepo, querySqlite, resetConfigDb, resetTestDirs } from '../helpers/fixtures';
import { DEFAULT_UI_TIMEOUT, ensureHome, importRepoViaUi, reloadToHome } from '../helpers/ui';

test.describe('Import workflow', () => {
  test.beforeEach(async ({ tauriPage }) => {
    resetTestDirs();
    resetConfigDb();
    await reloadToHome(tauriPage);
  });

  test('imports a local repo and records it in recent projects', async ({ tauriPage }) => {
    const repoPath = createTestRepo('import-test', { extraCommits: 3 });
    await importRepoViaUi(tauriPage, repoPath);
    await tauriPage.getByTestId('btn-back-projects').waitFor(DEFAULT_UI_TIMEOUT);

    await ensureHome(tauriPage);
    const waitDeadline = Date.now() + DEFAULT_UI_TIMEOUT;
    let recentProjects: string[] = [];
    while (Date.now() < waitDeadline) {
      recentProjects = await tauriPage.allTextContents('[data-testid="recent-project"]');
      if (recentProjects.some((value) => value.includes('import-test'))) {
        break;
      }
      await new Promise(resolve => setTimeout(resolve, 120));
    }

    if (!recentProjects.some((value) => value.includes('import-test'))) {
      throw new Error(`Recent projects did not contain import-test: ${recentProjects.join(' | ')}`);
    }

    const workspacePath = join(dirname(dirname(repoPath)), `${basename(repoPath)}-workspace`);

    // SQLite assertion: state.db meta table has workspace_path entry
    const stateDbPath = join(workspacePath, '.sproutgit', 'state.db');
    const metaRows = querySqlite(
      stateDbPath,
      `SELECT value FROM meta WHERE key = 'workspace_path'`,
    );
    expect(metaRows.length).toBe(1);
    expect(metaRows[0]?.[0]).toContain('import-test-workspace');
  });
});