import { execSync } from 'child_process';
import { mkdtempSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { gotoHash, monitorErrors, closeAndCleanup } from '../helpers.js';

/**
 * Sidebar collapse: toggle button, Cmd/Ctrl+B shortcut, and worktree switching
 * from the collapsed icon rail.
 */

/** Bootstrap a fresh git repo with one commit and return its path. */
function createFreshRepo(name: string): string {
  const dir = mkdtempSync(join(tmpdir(), `sg-sidebar-${name}-`));
  execSync('git init', { cwd: dir });
  execSync('git config user.email "test@example.com"', { cwd: dir });
  execSync('git config user.name "Test"', { cwd: dir });
  writeFileSync(join(dir, 'README.md'), `# ${name}\n`);
  execSync('git add .', { cwd: dir });
  execSync('git commit -m "init: initial commit"', { cwd: dir });
  return dir;
}

/** Import a repo via the API and navigate to its workspace view. */
async function importAndNavigate(sourceRepoPath: string): Promise<{ workspacePath: string; worktreesPath: string }> {
  const result = (await browser.execute(
    (path: string) => (window as any).api.importWorkspace({ sourceRepoPath: path }),
    sourceRepoPath
  )) as { workspacePath: string; worktreesPath: string };
  // The collapsed flag persists in sessionStorage across specs in the same
  // WDIO session (see app/src/renderer/routes/workspace.tsx). Reset it before
  // navigating so each test starts from the expanded state regardless of
  // what a previous test in this file left behind.
  await browser.execute(() => sessionStorage.setItem('sg_sidebar_collapsed', '0'));
  await gotoHash(`/workspace?path=${encodeURIComponent(result.workspacePath)}`);
  await expect($('[data-testid="btn-open-create-worktree"]')).toBeDisplayed();
  return result;
}

async function createWorktree(branchName: string): Promise<void> {
  await $('[data-testid="btn-open-create-worktree"]').click();
  await expect($('[data-testid="input-new-branch"]')).toBeDisplayed();
  await $('[data-testid="input-new-branch"]').setValue(branchName);
  await $('[data-testid="btn-create-worktree"]').click();
  await expect($(`[data-testid="worktree-item"][data-branch="${branchName}"]`)).toBeDisplayed();
}

describe('sidebar collapse', () => {
  let repoDir: string;

  beforeEach(() => {
    repoDir = createFreshRepo('collapse');
  });

  afterEach(async () => {
    await closeAndCleanup(repoDir);
  });

  it('collapses and expands the sidebar via the toggle button', async () => {
    const assertNoErrors = monitorErrors();
    await importAndNavigate(repoDir);

    // Expanded by default — full worktree list item visible, no rail.
    await expect($('[data-testid="worktree-item"]')).toBeDisplayed();
    await expect($('[data-testid="btn-toggle-sidebar"]')).toBeDisplayed();
    await expect($('[data-testid="worktree-rail-item"]')).not.toBeDisplayed();

    // Collapse.
    await $('[data-testid="btn-toggle-sidebar"]').click();
    await expect($('[data-testid="btn-expand-sidebar"]')).toBeDisplayed();
    await expect($('[data-testid="worktree-item"]')).not.toBeDisplayed();

    // Expand again.
    await $('[data-testid="btn-expand-sidebar"]').click();
    await expect($('[data-testid="btn-toggle-sidebar"]')).toBeDisplayed();
    await expect($('[data-testid="worktree-item"]')).toBeDisplayed();

    await assertNoErrors();
  });

  it('toggles the sidebar with Cmd/Ctrl+B', async () => {
    const assertNoErrors = monitorErrors();
    await importAndNavigate(repoDir);

    await expect($('[data-testid="worktree-item"]')).toBeDisplayed();

    const modifier = process.platform === 'darwin' ? 'Meta' : 'Control';

    // Collapse via shortcut.
    await browser.keys([modifier, 'b']);
    await expect($('[data-testid="btn-expand-sidebar"]')).toBeDisplayed();
    await expect($('[data-testid="worktree-item"]')).not.toBeDisplayed();

    // Expand via shortcut again.
    await browser.keys([modifier, 'b']);
    await expect($('[data-testid="btn-toggle-sidebar"]')).toBeDisplayed();
    await expect($('[data-testid="worktree-item"]')).toBeDisplayed();

    await assertNoErrors();
  });

  it('switches worktrees from the collapsed icon rail', async () => {
    const assertNoErrors = monitorErrors();
    await importAndNavigate(repoDir);

    await createWorktree('feature/rail-switch');

    // Collapse the sidebar.
    await $('[data-testid="btn-toggle-sidebar"]').click();
    await expect($('[data-testid="btn-expand-sidebar"]')).toBeDisplayed();

    // The rail should show an icon for the new worktree.
    const railItem = $('[data-testid="worktree-rail-item"][data-path*="rail-switch"]');
    await expect(railItem).toBeDisplayed();

    // Click it to switch — the tab bar (only rendered once a worktree is
    // active) should appear, confirming the switch succeeded while collapsed.
    await railItem.click();
    await expect($('//*[contains(@class,"sg-tab") and contains(.,"Changes")]')).toBeDisplayed();

    // Sidebar should remain collapsed after switching (rail still visible).
    await expect($('[data-testid="worktree-rail-item"]')).toBeDisplayed();

    await assertNoErrors();
  });

  it('gives the sidebar toolbar and main tab bar the same height', async () => {
    // Regression guard for the shared --sg-toolbar-height token: the sidebar's
    // compact icon toolbar and the main content tab bar were previously two
    // different hardcoded heights.
    const assertNoErrors = monitorErrors();
    await importAndNavigate(repoDir);
    await expect($('[data-testid="btn-toggle-sidebar"]')).toBeDisplayed();

    const heights = await browser.execute(() => {
      const toolbar = document.querySelector('[data-testid="btn-toggle-sidebar"]')?.closest('div');
      const tabBar = document.querySelector('.sg-tab')?.parentElement;
      return {
        toolbar: toolbar?.getBoundingClientRect().height ?? null,
        tabBar: tabBar?.getBoundingClientRect().height ?? null,
      };
    });

    expect(heights.toolbar).not.toBeNull();
    expect(heights.tabBar).not.toBeNull();
    expect(heights.toolbar).toBe(heights.tabBar);

    await assertNoErrors();
  });
});
