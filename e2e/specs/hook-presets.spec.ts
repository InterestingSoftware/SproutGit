/**
 * Worktree creation presets (issue #98): one-click templates in the hooks
 * dialog that pre-fill a reviewable local-hook draft for the common
 * "make a fresh worktree runnable" chores — copying .env files, installing
 * dependencies, symlinking a shared cache. Presets never save or run
 * anything on their own; they only seed the same create-hook form a
 * hand-written hook goes through.
 */
import { gotoHash, createTestRepo, closeAndCleanup, monitorErrors } from '../helpers.js';

describe('worktree creation presets', () => {
  let testRepo: string;

  beforeEach(() => {
    testRepo = createTestRepo('hook-presets');
  });

  afterEach(async () => {
    await closeAndCleanup(testRepo);
  });

  it('pre-fills a reviewable hook draft from the "Install dependencies" preset and persists it on save', async () => {
    const assertNoErrors = monitorErrors();
    await gotoHash(`/workspace?path=${encodeURIComponent(testRepo)}`);

    await $('[data-testid="btn-open-hooks-modal"]').click();
    await expect($('[data-testid="modal-workspace-hooks"]')).toBeDisplayed();

    await $('[data-testid="btn-add-hook-preset"]').click();
    await expect($('[data-testid="context-menu"]')).toBeDisplayed();
    await $('[data-testid="context-menu"]')
      .$('.//button[contains(.,"Install dependencies")]')
      .click();

    // Preset only seeds the draft editor — nothing is saved or run yet.
    await expect($('[data-testid="input-hook-name"]')).toHaveValue('Install dependencies');
    await expect($('.monaco-editor .view-lines')).toBeDisplayed();
    const script = await $('.monaco-editor .view-lines').getText();
    expect(script).toContain('pnpm-lock.yaml');

    // Closing the modal auto-saves the reviewed draft as a local hook.
    // Dispatched directly on the backdrop node since the modal box itself
    // covers most of the viewport, so a coordinate-based click would
    // normally land on the (non-closing) box on top of it instead.
    await browser.execute(() => {
      document.querySelector('[data-testid="modal-workspace-hooks-backdrop"]')
        ?.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
    });
    await expect($('[data-testid="modal-workspace-hooks"]')).not.toBeDisplayed();

    await $('[data-testid="btn-open-hooks-modal"]').click();
    await expect(
      $('[data-testid="modal-workspace-hooks"]').$('.//div[contains(.,"Install dependencies")]')
    ).toBeDisplayed();

    await assertNoErrors();
  });

  it('offers copy-env-files and symlink-shared-cache presets alongside install', async () => {
    const assertNoErrors = monitorErrors();
    await gotoHash(`/workspace?path=${encodeURIComponent(testRepo)}`);

    await $('[data-testid="btn-open-hooks-modal"]').click();
    await $('[data-testid="btn-add-hook-preset"]').click();
    await expect($('[data-testid="context-menu"]')).toBeDisplayed();

    await expect(
      $('[data-testid="context-menu"]').$('.//button[contains(.,"Copy .env files")]')
    ).toBeDisplayed();
    await expect(
      $('[data-testid="context-menu"]').$('.//button[contains(.,"Symlink shared cache")]')
    ).toBeDisplayed();

    await assertNoErrors();
  });
});
