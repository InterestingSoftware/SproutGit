import { readFileSync } from 'fs';
import { join } from 'path';
import { gotoHash, createTestRepo, closeAndCleanup, monitorErrors } from '../helpers.js';

describe('file editor workflow', () => {
  let testRepo: string;

  beforeEach(() => {
    testRepo = createTestRepo('file-editor');
  });

  afterEach(async () => {
    await closeAndCleanup(testRepo);
  });

  it('opens a file from the tree, edits it, saves it, and persists the change to disk', async () => {
    const assertNoErrors = monitorErrors();

    await gotoHash(`/workspace?path=${encodeURIComponent(testRepo)}`);
    await expect($('//*[contains(@class,"sg-tab") and contains(.,"Graph")]')).toBeDisplayed();
    // The Files tab is disabled until activeWorktree resolves -- wait for the
    // sidebar worktree item (same signal file-live-sync.spec.ts uses) rather
    // than clicking immediately, which raced and lost intermittently on
    // slower CI (the tab button stays disabled and the click is a no-op).
    await expect($('[data-testid="worktree-item"]')).toBeDisplayed();

    // Switch to the Files tab.
    await $('[data-testid="tab-files"]').click();

    // README.md (created by createTestRepo) should appear in the file tree.
    const readmeNode = $('[data-testid="file-tree-file"][data-path="README.md"]');
    await expect(readmeNode).toBeDisplayed();

    // Open it — a tab should appear in the editor strip.
    await readmeNode.click();
    const editorTab = $('[data-testid="file-editor-tab"][data-path="README.md"]');
    await expect(editorTab).toBeDisplayed();
    await expect(editorTab).toHaveAttribute('aria-selected', 'true');

    // The Monaco editor should render the file's original content.
    await expect($('.monaco-editor .view-lines')).toBeDisplayed();
    const initialText = await $('.monaco-editor .view-lines').getText();
    expect(initialText).toContain('# test');

    // Save button should be disabled — nothing has been edited yet.
    await expect($('[data-testid="btn-save-file"]')).toBeDisabled();

    // Click into the editor body and append a new line of text.
    await $('.monaco-editor .view-lines').click();
    await browser.keys(['End']);
    await browser.keys(['Enter']);
    await browser.keys('Hello from the e2e test'.split(''));

    // Dirty indicators: unsaved dot on the tab, enabled Save button.
    await expect($('[data-testid="btn-save-file"]')).toBeEnabled();

    // Save via the toolbar button.
    await $('[data-testid="btn-save-file"]').click();

    // Save button becomes disabled again once the tab is clean.
    await expect($('[data-testid="btn-save-file"]')).toBeDisabled();

    // Find the on-disk worktree path via the sidebar's data-path attribute
    // (testRepo's .git was converted to a bare root on open, so the actual
    // checkout — and the file we just saved — lives under the managed
    // worktree directory, not testRepo itself).
    const worktreePath = await $('[data-testid="worktree-item"]').getAttribute('data-path');
    expect(worktreePath).toBeTruthy();

    const savedContent = readFileSync(join(worktreePath, 'README.md'), 'utf8');
    expect(savedContent).toContain('# test');
    expect(savedContent).toContain('Hello from the e2e test');

    await assertNoErrors();
  });
});
