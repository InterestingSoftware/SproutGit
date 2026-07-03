import { gotoHash, createTestRepo, closeAndCleanup, monitorErrors } from '../helpers.js';
import { execSync } from 'child_process';
import { writeFileSync } from 'fs';
import { join } from 'path';

const GENERATED_MESSAGE = 'feat: e2e generated commit message';

describe('commit message generator', () => {
  let testRepo: string;

  beforeEach(() => {
    testRepo = createTestRepo('commitmsg');
  });

  afterEach(async () => {
    await closeAndCleanup(testRepo);
  });

  it('generates a commit message from the staged diff and fills the textarea', async () => {
    const assertNoErrors = monitorErrors();

    // Configure a fake generator — a Node script that ignores stdin and
    // prints a fixed message — so the test doesn't depend on a real AI CLI
    // being installed on the machine running e2e.
    await browser.executeAsync((message: string, done: (err?: string) => void) => {
      (window as unknown as { api: { setSetting: (k: string, v: string) => Promise<void> } })
        .api.setSetting('commitMessageGenerator', JSON.stringify({
          presetId: 'custom',
          command: 'node',
          args: ['-e', `console.log(${JSON.stringify(message)})`],
        }))
        .then(() => done(), (e: unknown) => done(String(e)));
    }, GENERATED_MESSAGE);

    // Opening the workspace converts testRepo's `.git` into a bare root and
    // recreates this branch as a managed worktree — capture the branch now
    // so we can find that worktree's on-disk path afterwards.
    const defaultBranch = execSync('git symbolic-ref --short HEAD', { cwd: testRepo }).toString().trim();

    // Open the workspace and switch to the staging tab.
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

    await $('//*[contains(@class,"sg-tab") and contains(.,"Changes")]').click();

    // Stage the new file.
    await expect($('//*[contains(@class,"sg-file-row") and contains(.,"hello.txt")]')).toBeDisplayed();
    await $('//*[contains(@class,"sg-file-row") and contains(.,"hello.txt")]')
      .$('button[title="Stage file"]')
      .click();
    await expect($('.sg-file-status--staged')).toBeDisplayed();

    // Generate button should be enabled now that something is staged.
    const generateBtn = $('[data-testid="btn-generate-commit-message"]');
    await expect(generateBtn).toBeEnabled();
    await generateBtn.click();

    // The commit message box should be filled with the generator's output.
    await expect($('.sg-commit-input')).toHaveValue(GENERATED_MESSAGE);

    await assertNoErrors();
  });
});
