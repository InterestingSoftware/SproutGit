/**
 * Daily workflow: parallel feature worktrees lifecycle.
 *
 * Ported from old/e2e/specs/daily-workflow.spec.ts (Tauri). Each test is
 * self-contained — it creates its own git repo, imports it as a SproutGit
 * workspace, and cleans up afterwards.
 */

import { gotoHash, monitorErrors, waitForToast, closeAndCleanup } from '../helpers.js';
import { execSync } from 'child_process';
import { mkdtempSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';

// ---------------------------------------------------------------------------
// Local helpers
// ---------------------------------------------------------------------------

/** Bootstrap a fresh git repo with one commit and return its path. */
function createFreshRepo(name: string): string {
  const dir = mkdtempSync(join(tmpdir(), `sg-daily-${name}-`));
  execSync('git init', { cwd: dir });
  execSync('git config user.email "test@example.com"', { cwd: dir });
  execSync('git config user.name "Test"', { cwd: dir });
  writeFileSync(join(dir, 'README.md'), `# ${name}\n`);
  execSync('git add .', { cwd: dir });
  execSync('git commit -m "init: initial commit"', { cwd: dir });
  return dir;
}

/** Import a repo via the API and navigate to its workspace view. */
async function importAndNavigate(
  sourceRepoPath: string
): Promise<{ workspacePath: string; worktreesPath: string }> {
  const result = (await browser.execute(
    (path: string) => (window as any).api.importWorkspace({ sourceRepoPath: path }),
    sourceRepoPath
  )) as { workspacePath: string; worktreesPath: string };
  await gotoHash(`/workspace?path=${encodeURIComponent(result.workspacePath)}`);
  await expect($('[data-testid="btn-open-create-worktree"]')).toBeDisplayed();
  return result;
}

/**
 * Open the New Worktree dialog, fill branch name (and optionally source ref),
 * submit, and wait for the new worktree item to appear in the sidebar.
 */
async function createWorktree(branchName: string, sourceRef?: string): Promise<void> {
  await $('[data-testid="btn-open-create-worktree"]').click();
  await expect($('[data-testid="input-new-branch"]')).toBeDisplayed();

  if (sourceRef) {
    await $('[data-testid="from-ref-container"] button').click();
    await $('[data-testid="from-ref-container"] input').setValue(sourceRef);
    await browser.keys('Enter');
  }

  await $('[data-testid="input-new-branch"]').setValue(branchName);
  await $('[data-testid="btn-create-worktree"]').click();

  // Wait for the new worktree item to appear in the sidebar.
  await expect($(`[data-testid="worktree-item"][data-branch="${branchName}"]`)).toBeDisplayed();
}

/** Switch to a worktree by clicking its sidebar item and wait for the tab bar. */
async function switchToWorktree(branchName: string): Promise<void> {
  await $(`[data-testid="worktree-item"][data-branch="${branchName}"]`).click();
  await expect($('//*[contains(@class,"sg-tab") and contains(.,"Changes")]')).toBeDisplayed();
}

/** Stage a file and commit with the given message via the Changes tab UI. */
async function stageAndCommit(filename: string, message: string): Promise<void> {
  await $('//*[contains(@class,"sg-tab") and contains(.,"Changes")]').click();
  await expect($(`//*[contains(@class,"sg-file-row") and contains(.,"${filename}")]`)).toBeDisplayed();
  await $(`//*[contains(@class,"sg-file-row") and contains(.,"${filename}")]`)
    .$('button[title="Stage file"]')

    .click();
  await expect($('.sg-file-status--staged')).toBeDisplayed();
  await $('.sg-commit-input').setValue(message);
  await $('//*[contains(@class,"sg-btn--primary") and contains(.,"Commit")]').click();
  await expect($('.sg-commit-input')).toHaveValue('');
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('daily workflow', () => {
  it('creates two parallel feature worktrees from a fresh repo', async () => {
    const assertNoErrors = monitorErrors();
    const repoDir = createFreshRepo('parallel');
    try {
      await importAndNavigate(repoDir);

      // Create the first feature worktree.
      await createWorktree('feature/user-auth');
      await expect($('[data-testid="worktree-item"][data-branch="feature/user-auth"]')).toBeDisplayed();

      // Create the second feature worktree.
      await createWorktree('bugfix/login-crash');
      await expect($('[data-testid="worktree-item"][data-branch="bugfix/login-crash"]')).toBeDisplayed();

      // Both items should coexist in the sidebar (root + 2 new = 3 total).
      await expect($$('[data-testid="worktree-item"]')).toBeElementsArrayOfSize(3);
      await assertNoErrors();
    } finally {
      // Close the workspace DB before deleting (prevents Windows EBUSY).
      await closeAndCleanup(repoDir);
    }
  });

  it('commits changes on each worktree independently', async () => {
    const assertNoErrors = monitorErrors();
    const repoDir = createFreshRepo('commits');
    try {
      const { worktreesPath } = await importAndNavigate(repoDir);

      await createWorktree('feature/api');
      await createWorktree('feature/ui');

      // Switch to feature/api, write a file, and commit.
      await switchToWorktree('feature/api');
      const apiWorktreePath = join(worktreesPath, 'feature', 'api');
      writeFileSync(join(apiWorktreePath, 'api.ts'), 'export {};\n');
      await stageAndCommit('api.ts', 'feat: add api stub');
      await waitForToast('success');

      // Switch to feature/ui and verify api.ts is absent there.
      await switchToWorktree('feature/ui');
      const uiWorktreePath = join(worktreesPath, 'feature', 'ui');
      const apiFileInUi = execSync('git ls-files api.ts', { cwd: uiWorktreePath })
        .toString()
        .trim();
      expect(apiFileInUi).toBe('');

      // Write a different file on feature/ui and commit.
      writeFileSync(join(uiWorktreePath, 'ui.ts'), 'export {};\n');
      await stageAndCommit('ui.ts', 'feat: add ui stub');
      await waitForToast('success');

      // Verify feature/api does NOT have ui.ts.
      const uiFileInApi = execSync('git ls-files ui.ts', { cwd: apiWorktreePath })
        .toString()
        .trim();
      expect(uiFileInApi).toBe('');
      await assertNoErrors();
    } finally {
      await closeAndCleanup(repoDir);
    }
  });

  it('deletes a merged bugfix worktree while keeping the feature worktree', async () => {
    const assertNoErrors = monitorErrors();
    const repoDir = createFreshRepo('delete');
    // Import converts repoDir's `.git` into a bare root and recreates this
    // branch as a managed worktree — repoDir itself is no longer a git repo
    // afterwards, so capture the branch now to find that worktree later.
    const defaultBranch = execSync('git symbolic-ref --short HEAD', { cwd: repoDir }).toString().trim();
    try {
      const { worktreesPath } = await importAndNavigate(repoDir);

      await createWorktree('feature/ongoing');
      await createWorktree('bugfix/merged-fix');

      // Make a commit on bugfix/merged-fix so it can be merged.
      const bugfixPath = join(worktreesPath, 'bugfix', 'merged-fix');
      writeFileSync(join(bugfixPath, 'fix.txt'), 'fixed\n');
      execSync('git add fix.txt', { cwd: bugfixPath });
      execSync('git commit -m "fix: merged-fix"', { cwd: bugfixPath });

      // Merge bugfix/merged-fix into the default branch's worktree (so it's "fully merged").
      execSync('git merge --no-ff bugfix/merged-fix -m "Merge bugfix/merged-fix"', {
        cwd: join(worktreesPath, defaultBranch),
      });

      // Right-click the bugfix item to open the context menu.
      // CDP pointer actions don't reliably generate a contextmenu event in
      // Electron on Windows, so dispatch it directly via JavaScript instead.
      // Query the element inside execute() to avoid WebdriverIO serialisation issues.
      await browser.execute((branch: string) => {
        const el = document.querySelector(`[data-testid="worktree-item"][data-branch="${branch}"]`) as HTMLElement | null;
        if (!el) throw new Error(`worktree-item[data-branch="${branch}"] not found`);
        const rect = el.getBoundingClientRect();
        el.dispatchEvent(new MouseEvent('contextmenu', {
          bubbles: true,
          cancelable: true,
          button: 2,
          clientX: rect.left + rect.width / 2,
          clientY: rect.top + rect.height / 2,
        }));
      }, 'bugfix/merged-fix');

      // Click "Remove Worktree" in the context menu. Scope to the context-menu
      // portal element so the XPath doesn't match a high-level ancestor like
      // <html> or <body> (which would close the menu before the item fires).
      await expect($('[data-testid="context-menu"]')).toBeDisplayed();
      await $('[data-testid="context-menu"]')
        .$('.//button[contains(.,"Remove Worktree")]')
        .click();

      // Confirm deletion in the dialog.
      await expect($('[data-testid="btn-confirm-delete-worktree"]')).toBeDisplayed();
      await $('[data-testid="btn-confirm-delete-worktree"]').click();

      // bugfix/merged-fix should disappear from the sidebar; a success toast appears.
      await expect(
        $('[data-testid="worktree-item"][data-branch="bugfix/merged-fix"]')
      ).not.toBeDisplayed();
      await waitForToast('success');

      // feature/ongoing should still be present.
      await expect(
        $('[data-testid="worktree-item"][data-branch="feature/ongoing"]')
      ).toBeDisplayed();
      await assertNoErrors();
    } finally {
      await closeAndCleanup(repoDir);
    }
  });
});
