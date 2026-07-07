import { gotoHash, createTestRepo, closeAndCleanup, monitorErrors, waitForToast } from '../helpers.js';
import { execSync } from 'child_process';
import { writeFileSync } from 'fs';
import { join } from 'path';

describe('stash workflow', () => {
  let testRepo: string;

  beforeEach(() => {
    testRepo = createTestRepo('stash');
  });

  afterEach(async () => {
    await closeAndCleanup(testRepo);
  });

  it('stashes uncommitted changes and pops them back', async () => {
    const assertNoErrors = monitorErrors();

    const defaultBranch = execSync('git symbolic-ref --short HEAD', { cwd: testRepo }).toString().trim();

    await gotoHash(`/workspace?path=${encodeURIComponent(testRepo)}`);
    await expect($(`[data-testid="worktree-item"][data-branch="${defaultBranch}"]`)).toBeDisplayed();

    const worktreePath = join(testRepo, '.sproutgit', 'worktrees', defaultBranch);
    writeFileSync(join(worktreePath, 'README.md'), '# test\nlocal change\n');

    // Switch to the staging tab.
    await $('//*[contains(@class,"sg-tab") and contains(.,"Changes")]').click();
    await expect($('//*[contains(@class,"sg-file-row") and contains(.,"README.md")]')).toBeDisplayed();

    // Expand the stash panel and create a stash.
    await $('[data-testid="btn-toggle-stash-panel"]').click();
    await $('[data-testid="input-stash-message"]').setValue('wip changes');
    await $('[data-testid="btn-create-stash"]').click();
    await waitForToast('success');

    // The working tree is now clean and one stash entry exists.
    await expect($('//*[contains(@class,"sg-file-row") and contains(.,"README.md")]')).not.toBeDisplayed();
    await expect($('[data-testid="stash-row"]')).toBeDisplayed();
    expect(await $('[data-testid="stash-row"]').getText()).toContain('wip changes');

    // Pop it back.
    await $('[data-testid="btn-pop-stash"]').click();
    await waitForToast('success');

    await expect($('[data-testid="stash-row"]')).not.toBeDisplayed();
    await expect($('//*[contains(@class,"sg-file-row") and contains(.,"README.md")]')).toBeDisplayed();

    await assertNoErrors();
  });
});

describe('cherry-pick workflow', () => {
  let testRepo: string;

  beforeEach(() => {
    testRepo = createTestRepo('cherry-pick');
  });

  afterEach(async () => {
    await closeAndCleanup(testRepo);
  });

  it('cherry-picks a commit from another branch onto the active branch via the graph context menu', async () => {
    const assertNoErrors = monitorErrors();

    const defaultBranch = execSync('git symbolic-ref --short HEAD', { cwd: testRepo }).toString().trim();

    // Create a second branch with a commit to cherry-pick, then return to default.
    execSync('git checkout -b feature', { cwd: testRepo });
    writeFileSync(join(testRepo, 'feature.txt'), 'feature content\n');
    execSync('git add feature.txt', { cwd: testRepo });
    execSync('git commit -m "add feature file"', { cwd: testRepo });
    execSync(`git checkout ${defaultBranch}`, { cwd: testRepo });

    await gotoHash(`/workspace?path=${encodeURIComponent(testRepo)}`);
    await expect($(`[data-testid="worktree-item"][data-branch="${defaultBranch}"]`)).toBeDisplayed();

    // Right-click the "add feature file" commit row in the graph.
    // CDP pointer actions don't reliably generate a contextmenu event in
    // Electron, so dispatch it directly (same approach as the worktree
    // sidebar's context-menu test).
    await expect($('//*[contains(@class,"commit-row") and contains(.,"add feature file")]')).toBeDisplayed();
    await browser.execute(() => {
      const rows = Array.from(document.querySelectorAll('.commit-row'));
      const el = rows.find(r => r.textContent?.includes('add feature file')) as HTMLElement | undefined;
      if (!el) throw new Error('commit row for "add feature file" not found');
      const rect = el.getBoundingClientRect();
      el.dispatchEvent(new MouseEvent('contextmenu', {
        bubbles: true,
        cancelable: true,
        button: 2,
        clientX: rect.left + rect.width / 2,
        clientY: rect.top + rect.height / 2,
      }));
    });

    await expect($('[data-testid="context-menu"]')).toBeDisplayed();
    await $('[data-testid="context-menu"]')
      .$('.//button[contains(.,"Cherry-pick")]')
      .click();

    await waitForToast('success');

    // The default branch's worktree should now contain feature.txt.
    const worktreePath = join(testRepo, '.sproutgit', 'worktrees', defaultBranch);
    const log = execSync('git log --format=%s -1', { cwd: worktreePath }).toString().trim();
    expect(log).toBe('add feature file');

    await assertNoErrors();
  });
});
