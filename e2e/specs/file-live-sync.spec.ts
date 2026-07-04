import { writeFileSync } from 'fs';
import { join } from 'path';
import { gotoHash, createTestRepo, closeAndCleanup, monitorErrors, E2E_TIMEOUT_MS } from '../helpers.js';

describe('file live-sync workflow', () => {
  let testRepo: string;

  beforeEach(() => {
    testRepo = createTestRepo('file-livesync');
  });

  afterEach(async () => {
    await closeAndCleanup(testRepo);
  });

  it('auto-reloads a clean tab when the file changes on disk externally', async () => {
    const assertNoErrors = monitorErrors();

    await gotoHash(`/workspace?path=${encodeURIComponent(testRepo)}`);
    await expect($('//*[contains(@class,"sg-tab") and contains(.,"Graph")]')).toBeDisplayed();
    await expect($('[data-testid="worktree-item"]')).toBeDisplayed();
    const worktreePath = await $('[data-testid="worktree-item"]').getAttribute('data-path');

    await $('[data-testid="tab-files"]').click();
    await $('[data-testid="file-tree-file"][data-path="README.md"]').click();
    await expect($('[data-testid="file-editor-tab"][data-path="README.md"]')).toBeDisplayed();
    await expect($('.monaco-editor .view-lines')).toBeDisplayed();

    // Tab is clean (just opened, no local edits). Write to the file
    // externally, as an agent or another tool would, and expect the watcher
    // to auto-reload the buffer with no conflict banner.
    writeFileSync(join(worktreePath, 'README.md'), '# test\n\nchanged externally, no local edits\n');

    await browser.waitUntil(
      async () => {
        const text = await $('.monaco-editor .view-lines').getText();
        return text.includes('changed externally');
      },
      { timeout: E2E_TIMEOUT_MS, timeoutMsg: 'expected the clean tab to auto-reload external disk changes' }
    );

    expect(await $('[data-testid="file-conflict-banner"]').isExisting()).toBe(false);
    // Still not dirty — this was a silent reload, not a local edit.
    await expect($('[data-testid="btn-save-file"]')).toBeDisabled();

    await assertNoErrors();
  });

  it('shows a conflict banner (not a silent overwrite) when disk changes under a dirty tab', async () => {
    const assertNoErrors = monitorErrors();

    await gotoHash(`/workspace?path=${encodeURIComponent(testRepo)}`);
    await expect($('//*[contains(@class,"sg-tab") and contains(.,"Graph")]')).toBeDisplayed();
    await expect($('[data-testid="worktree-item"]')).toBeDisplayed();
    const worktreePath = await $('[data-testid="worktree-item"]').getAttribute('data-path');

    await $('[data-testid="tab-files"]').click();
    await $('[data-testid="file-tree-file"][data-path="README.md"]').click();
    await expect($('[data-testid="file-editor-tab"][data-path="README.md"]')).toBeDisplayed();
    await expect($('.monaco-editor .view-lines')).toBeDisplayed();

    // Make a local, unsaved edit so the tab is dirty.
    await $('.monaco-editor .view-lines').click();
    await browser.keys(['End']);
    await browser.keys(['Enter']);
    await browser.keys('local unsaved edit'.split(''));
    await expect($('[data-testid="btn-save-file"]')).toBeEnabled();

    // Now the file changes on disk externally, while local edits are unsaved.
    writeFileSync(join(worktreePath, 'README.md'), '# test\n\nchanged externally while dirty\n');

    const conflictBanner = $('[data-testid="file-conflict-banner"]');
    await conflictBanner.waitForDisplayed({
      timeout: E2E_TIMEOUT_MS,
      timeoutMsg: 'expected a conflict banner instead of a silent overwrite for a dirty tab',
    });

    // The local buffer must be preserved, not clobbered by the external change.
    const textWhileConflicted = await $('.monaco-editor .view-lines').getText();
    expect(textWhileConflicted).toContain('local unsaved edit');
    expect(textWhileConflicted).not.toContain('changed externally while dirty');

    // Resolve by keeping local edits — banner dismisses, buffer unchanged, still dirty.
    await $('[data-testid="btn-conflict-keep-mine"]').click();
    await expect(conflictBanner).not.toBeDisplayed();
    const textAfterKeepMine = await $('.monaco-editor .view-lines').getText();
    expect(textAfterKeepMine).toContain('local unsaved edit');
    await expect($('[data-testid="btn-save-file"]')).toBeEnabled();

    await assertNoErrors();
  });
});
