/**
 * `.issuetracker` support: parsing, commit-subject linkification, and
 * worktree-creation issue tagging.
 */

import { gotoHash, createTestRepo, closeAndCleanup, monitorErrors } from '../helpers.js';
import { execSync } from 'child_process';
import { writeFileSync, realpathSync } from 'fs';
import { join } from 'path';

const ISSUETRACKER_FILE = [
  '[issuetracker "Test"]',
  '    regex = "TEST-(\\\\d+)"',
  '    url = "https://issues.example.com/browse/TEST-$1"',
  '',
].join('\n');

async function importAndNavigate(sourceRepoPath: string): Promise<{ workspacePath: string; worktreesPath: string }> {
  const result = (await browser.execute(
    (path: string) => (window as any).api.importWorkspace({ sourceRepoPath: path }),
    sourceRepoPath
  )) as { workspacePath: string; worktreesPath: string };
  await gotoHash(`/workspace?path=${encodeURIComponent(result.workspacePath)}`);
  await expect($('[data-testid="btn-open-create-worktree"]')).toBeDisplayed();
  return result;
}

describe('.issuetracker support', () => {
  let testRepo: string;

  beforeEach(() => {
    // Resolved so the workspace path is already canonical (matches what
    // listWorktrees()/createManagedWorktree() each independently produce) —
    // otherwise a macOS /var → /private/var symlink in the raw tmpdir path
    // would make the two sides of a worktreePath comparison disagree.
    testRepo = realpathSync.native(createTestRepo('issuetracker'));
    writeFileSync(join(testRepo, '.issuetracker'), ISSUETRACKER_FILE);
  });

  afterEach(async () => {
    await closeAndCleanup(testRepo);
  });

  it('links a matching issue ref in a commit subject', async () => {
    const assertNoErrors = monitorErrors();
    execSync('echo "more" >> README.md', { cwd: testRepo });
    execSync('git add .', { cwd: testRepo });
    execSync('git commit -m "TEST-42: fix the thing"', { cwd: testRepo });

    const { workspacePath } = await importAndNavigate(testRepo);
    await gotoHash(`/workspace?path=${encodeURIComponent(workspacePath)}`);

    const link = await $('.commit-row-subject a');
    await expect(link).toBeDisplayed();
    await expect(link).toHaveText('TEST-42');
    await expect(link).toHaveAttribute('href', 'https://issues.example.com/browse/TEST-42');

    await assertNoErrors();
  });

  it('tags a new worktree with an issue ref and derives the branch name', async () => {
    const assertNoErrors = monitorErrors();
    const { workspacePath } = await importAndNavigate(testRepo);

    await $('[data-testid="btn-open-create-worktree"]').click();
    await expect($('[data-testid="input-new-worktree-issue"]')).toBeDisplayed();

    await $('[data-testid="input-new-branch"]').setValue('fix-thing');
    await $('[data-testid="input-new-worktree-issue"]').setValue('TEST-42');
    await $('[data-testid="input-new-branch"]').click(); // blur the issue field, triggering derivation

    const branchName = await $('[data-testid="input-new-branch"]').getValue();
    expect(branchName).toBe('TEST-42-fix-thing');

    await $('[data-testid="btn-create-worktree"]').click();
    const worktreeItem = $(`[data-testid="worktree-item"][data-branch="${branchName}"]`);
    await expect(worktreeItem).toBeDisplayed();
    const worktreePath = await worktreeItem.getAttribute('data-path');

    const meta = await browser.execute(
      (ws: string, wt: string) => (window as any).api.getWorktreeMeta(ws, wt),
      workspacePath,
      worktreePath
    ) as { issueRef: string | null };
    expect(meta?.issueRef).toBe('TEST-42');

    await assertNoErrors();
  });
});
