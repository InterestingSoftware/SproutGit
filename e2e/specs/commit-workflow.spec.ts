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

    // Wait for the migrated worktree to actually appear in the sidebar —
    // the "Graph" tab renders immediately on mount, well before the async
    // bare-root conversion finishes creating the worktree directory on
    // disk, so writing into it right after the tab check is a race
    // (harmless on a fast machine, but real on a slower one).
    await expect($(`[data-testid="worktree-item"][data-branch="${defaultBranch}"]`)).toBeDisplayed();

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

  it('stages and unstages a single hunk, leaving the file\'s other hunk untouched', async () => {
    const assertNoErrors = monitorErrors();

    const defaultBranch = execSync('git symbolic-ref --short HEAD', { cwd: testRepo }).toString().trim();

    // Commit a baseline multi-line tracked file before opening the workspace,
    // so the two edits below land far enough apart to produce two separate
    // diff hunks under git's default 3-line context.
    const baseline = Array.from({ length: 20 }, (_, i) => `line ${i + 1}`);
    writeFileSync(join(testRepo, 'notes.txt'), baseline.join('\n') + '\n');
    execSync('git add notes.txt', { cwd: testRepo });
    execSync('git commit -m "add notes.txt"', { cwd: testRepo });

    await gotoHash(`/workspace?path=${encodeURIComponent(testRepo)}`);
    await expect($('//*[contains(@class,"sg-tab") and contains(.,"Graph")]')).toBeDisplayed();
    await expect($(`[data-testid="worktree-item"][data-branch="${defaultBranch}"]`)).toBeDisplayed();

    const worktreePath = join(testRepo, '.sproutgit', 'worktrees', defaultBranch);
    const modified = [...baseline];
    modified[1] = 'LINE TWO';
    modified[15] = 'LINE SIXTEEN';
    writeFileSync(join(worktreePath, 'notes.txt'), modified.join('\n') + '\n');

    await $('//*[contains(@class,"sg-tab") and contains(.,"Changes")]').click();
    await expect($('//*[contains(@class,"sg-file-row") and contains(.,"notes.txt")]')).toBeDisplayed();
    await $('//*[contains(@class,"sg-file-row") and contains(.,"notes.txt")]').click();

    // Two separate hunks should render for the two far-apart edits.
    await expect($$('[data-testid="diff-hunk"]')).toBeElementsArrayOfSize(2);

    // Stage only the first hunk.
    await $('[data-testid="stage-hunk-btn"][data-hunk-index="0"]').click();

    // The diff view refreshes in place — only the second hunk should remain unstaged.
    await expect($$('[data-testid="diff-hunk"]')).toBeElementsArrayOfSize(1);
    await expect($('//*[contains(@class,"sg-diff-add") and contains(.,"LINE SIXTEEN")]')).toBeDisplayed();

    // The file now has both staged and unstaged changes.
    await expect($('[data-testid="staging-staged-file-row"][data-path="notes.txt"]')).toBeDisplayed();
    await expect($('[data-testid="staging-unstaged-file-row"][data-path="notes.txt"]')).toBeDisplayed();

    // The staged pane shows exactly the hunk that was staged.
    await $('[data-testid="staging-staged-file-row"][data-path="notes.txt"]').click();
    await expect($$('[data-testid="diff-hunk"]')).toBeElementsArrayOfSize(1);
    await expect($('//*[contains(@class,"sg-diff-add") and contains(.,"LINE TWO")]')).toBeDisplayed();

    // Unstage that hunk back — the file should return to fully unstaged.
    await $('[data-testid="unstage-hunk-btn"][data-hunk-index="0"]').click();
    await expect($('[data-testid="staging-staged-file-row"][data-path="notes.txt"]')).not.toBeDisplayed();

    await assertNoErrors();
  });
});
