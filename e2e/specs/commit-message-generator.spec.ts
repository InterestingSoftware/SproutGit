import { gotoHash, createTestRepo, closeAndCleanup, monitorErrors } from '../helpers.js';
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

    // Create an unstaged file.
    writeFileSync(join(testRepo, 'hello.txt'), 'hello world\n');

    // Open the workspace and switch to the staging tab.
    await gotoHash(`/workspace?path=${encodeURIComponent(testRepo)}`);
    await expect($('//*[contains(@class,"sg-tab") and contains(.,"Graph")]')).toBeDisplayed();
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
