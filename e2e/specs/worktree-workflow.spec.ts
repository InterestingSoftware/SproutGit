import { gotoHash, createTestRepo, closeAndCleanup, monitorErrors, waitForToast } from '../helpers.js';

/**
 * Import a repo via the API (converts it to the bare + managed-worktree
 * layout synchronously) and navigate to its workspace view — mirrors
 * daily-workflow.spec.ts's helper. Navigating straight to a plain repo path
 * instead and letting the app convert it lazily on mount is racy: the
 * toolbar's create-worktree button renders before that conversion (and the
 * workspace-status fetch reflecting it) finishes.
 */
async function importAndNavigate(sourceRepoPath: string): Promise<void> {
  const result = (await browser.execute(
    (path: string) => (window as any).api.importWorkspace({ sourceRepoPath: path }),
    sourceRepoPath
  )) as { workspacePath: string };
  await gotoHash(`/workspace?path=${encodeURIComponent(result.workspacePath)}`);
  await expect($('[data-testid="btn-open-create-worktree"]')).toBeDisplayed();
}

/**
 * Open the New Worktree dialog, fill branch name, submit, and wait for the
 * new worktree item to appear in the sidebar.
 */
async function createWorktree(branchName: string): Promise<void> {
  await $('[data-testid="btn-open-create-worktree"]').click();
  await expect($('[data-testid="input-new-branch"]')).toBeDisplayed();
  await $('[data-testid="input-new-branch"]').setValue(branchName);
  await $('[data-testid="btn-create-worktree"]').click();
  await expect($(`[data-testid="worktree-item"][data-branch="${branchName}"]`)).toBeDisplayed();
}

describe('worktree workflow', () => {
  let testRepo: string;

  beforeEach(() => {
    testRepo = createTestRepo('worktree');
  });

  afterEach(async () => {
    await closeAndCleanup(testRepo);
  });

  it('shows existing worktrees in the sidebar', async () => {
    const assertNoErrors = monitorErrors();
    await gotoHash(`/workspace?path=${encodeURIComponent(testRepo)}`);
    await expect($('.sg-worktree-btn')).toBeDisplayed();
    await assertNoErrors();
  });

  it('sidebar shows worktree branch name', async () => {
    const assertNoErrors = monitorErrors();
    await gotoHash(`/workspace?path=${encodeURIComponent(testRepo)}`);
    // The main worktree has a branch (master or main).
    const label = await $('.sg-worktree-label').getText();
    expect(label.length).toBeGreaterThan(0);
    await assertNoErrors();
  });

  it('restores a deleted worktree and its branch via the toast Undo action', async () => {
    const assertNoErrors = monitorErrors();
    await importAndNavigate(testRepo);

    await createWorktree('feature/undo-me');

    // Right-click the worktree item to open its context menu. CDP pointer
    // actions don't reliably generate a contextmenu event in Electron on
    // Windows, so dispatch it directly via JavaScript (matches the pattern
    // in daily-workflow.spec.ts).
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
    }, 'feature/undo-me');

    await expect($('[data-testid="context-menu"]')).toBeDisplayed();
    await $('[data-testid="context-menu"]')
      .$('.//button[contains(.,"Remove Worktree")]')
      .click();

    await expect($('[data-testid="btn-confirm-delete-worktree"]')).toBeDisplayed();
    await $('[data-testid="btn-confirm-delete-worktree"]').click();

    // Worktree disappears and a success toast with an Undo action appears.
    await expect(
      $('[data-testid="worktree-item"][data-branch="feature/undo-me"]')
    ).not.toBeDisplayed();
    await waitForToast('success');
    await expect($('[data-testid="toast-undo"]')).toBeDisplayed();

    await $('[data-testid="toast-undo"]').click();

    // The worktree (and its branch) reappear in the sidebar.
    await expect(
      $('[data-testid="worktree-item"][data-branch="feature/undo-me"]')
    ).toBeDisplayed();
    await assertNoErrors();
  });
});
