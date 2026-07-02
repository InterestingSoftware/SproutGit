import { gotoHash, createTestRepo, closeAndCleanup, monitorErrors, waitForToast } from '../helpers.js';
import { execSync } from 'child_process';
import { writeFileSync } from 'fs';
import { join } from 'path';

describe('commit workflow', () => {
  let testRepo: string;

  beforeEach(() => {
    testRepo = createTestRepo('commit');
  });

  afterEach(async () => {
    await closeAndCleanup(testRepo);
  });

  it('stages a file and creates a commit', async () => {
    const assertNoErrors = monitorErrors();

    // Opening the workspace converts testRepo's `.git` into a bare root and
    // recreates this branch as a managed worktree — capture the branch now
    // so we can find that worktree's on-disk path afterwards.
    const defaultBranch = execSync('git symbolic-ref --short HEAD', { cwd: testRepo }).toString().trim();

    // Open the workspace.
    await gotoHash(`/workspace?path=${encodeURIComponent(testRepo)}`);
    await expect($('//*[contains(@class,"sg-tab") and contains(.,"Graph")]')).toBeDisplayed();

    // Create an unstaged file inside the worktree created for defaultBranch
    // (testRepo itself is no longer a checkout after the bare-root conversion).
    writeFileSync(join(testRepo, '.sproutgit', 'worktrees', defaultBranch, 'hello.txt'), 'hello world\n');

    // Switch to the staging tab.
    await $('//*[contains(@class,"sg-tab") and contains(.,"Changes")]').click();

    // The new file should appear in unstaged.
    await expect($('//*[contains(@class,"sg-file-row") and contains(.,"hello.txt")]')).toBeDisplayed();

    // Stage it.
    await $('//*[contains(@class,"sg-file-row") and contains(.,"hello.txt")]')
      .$('button[title="Stage file"]')
      .click();

    // It should move to staged.
    await expect($('.sg-file-status--staged')).toBeDisplayed();

    // Write a commit message.
    await $('.sg-commit-input').setValue('Add hello.txt');

    // Click commit.
    await $('//*[contains(@class,"sg-btn--primary") and contains(.,"Commit")]').click();

    // Commit input should be cleared and a success toast should appear.
    await expect($('.sg-commit-input')).toHaveValue('');
    await waitForToast('success');

    await assertNoErrors();
  });
});
