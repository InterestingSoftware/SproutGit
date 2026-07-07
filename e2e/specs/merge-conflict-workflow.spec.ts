import { execSync } from 'child_process';
import { readFileSync, writeFileSync } from 'fs';
import { join } from 'path';
import { gotoHash, createTestRepo, closeAndCleanup, monitorErrors, waitForToast, E2E_TIMEOUT_MS } from '../helpers.js';

function delay(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

/**
 * The conflict banner has two paths to appear: an instant push from the
 * worktree file watcher, or the conflict-count query's own 15s
 * (`E2E_TIMEOUT_MS`) background-poll fallback. Waiting only up to
 * `E2E_TIMEOUT_MS` races that fallback with no margin — on a loaded CI
 * runner (or if the watcher misses git's temp-file+rename write, a known
 * inotify/chokidar edge case that a plain in-place write doesn't hit) the
 * poll can land just past the deadline. Give it real headroom above the
 * fallback interval instead of assuming the fast path always wins.
 */
const BANNER_TIMEOUT_MS = E2E_TIMEOUT_MS + 10_000;

/**
 * Runs a git command against `cwd`, retrying on a transient `index.lock`
 * collision — the app's own background status polling/file watcher can hold
 * the index lock for a moment at the same time this test drives git directly
 * from the outside, the same class of race `rmWithRetry` in helpers.ts guards
 * against for file deletion.
 */
async function runGit(command: string, cwd: string, expectFailure = false, attempts = 10): Promise<void> {
  for (let attempt = 1; attempt <= attempts; attempt++) {
    try {
      execSync(command, { cwd, stdio: 'pipe' });
      return;
    } catch (err) {
      const message = String((err as { stderr?: Buffer }).stderr ?? err);
      if (message.includes('index.lock') && attempt < attempts) {
        await delay(200 * attempt);
        continue;
      }
      if (expectFailure) return; // e.g. the merge command is expected to stop with a conflict.
      throw err;
    }
  }
}

/** Produces a real merge conflict on README.md directly in a managed worktree. */
async function createConflict(worktreePath: string): Promise<void> {
  await runGit('git checkout -b feature', worktreePath);
  writeFileSync(join(worktreePath, 'README.md'), '# test\nfeature change\n');
  await runGit('git commit -am "feature change"', worktreePath);

  await runGit('git checkout -', worktreePath);
  writeFileSync(join(worktreePath, 'README.md'), '# test\nmain change\n');
  await runGit('git commit -am "main change"', worktreePath);

  // Non-zero exit is expected here — the merge stops with a conflict.
  await runGit('git merge feature', worktreePath, true);
}

describe('merge conflict resolution workflow', () => {
  let testRepo: string;

  beforeEach(() => {
    testRepo = createTestRepo('merge-conflict');
  });

  afterEach(async () => {
    await closeAndCleanup(testRepo);
  });

  it('surfaces an unmerged file and resolves it through the Conflicts tab', async () => {
    const assertNoErrors = monitorErrors();

    await gotoHash(`/workspace?path=${encodeURIComponent(testRepo)}`);
    await expect($('[data-testid="worktree-item"]')).toBeDisplayed();
    const worktreePath = await $('[data-testid="worktree-item"]').getAttribute('data-path');
    expect(worktreePath).toBeTruthy();

    await createConflict(worktreePath);

    // The file watcher on the active worktree should pick up the conflicted
    // working-tree write and surface the banner without any manual refresh.
    await $('[data-testid="merge-conflict-banner"]').waitForDisplayed({
      timeout: BANNER_TIMEOUT_MS,
      timeoutMsg: 'expected the merge-conflict banner to appear once the working tree has an unmerged file',
    });
    await expect($('[data-testid="tab-conflicts"]')).toBeDisplayed();

    await $('[data-testid="btn-resolve-conflicts"]').click();
    await expect($('[data-testid="conflict-resolution-panel"]')).toBeDisplayed();

    const conflictFileItem = $('[data-testid="conflict-file-item"][data-path="README.md"]');
    await expect(conflictFileItem).toBeDisplayed();

    // One conflict block, resolved by accepting "ours" (the main-branch change).
    // Per-block accept buttons are keyed by the block's id (block-0, block-1, ...)
    // so they stay unambiguous when a file has more than one conflict.
    await expect($('[data-testid="conflict-remaining-count"]')).toHaveText('1 conflict remaining');
    await $('[data-testid="btn-accept-ours-block-0"]').click();
    await expect($('[data-testid="conflict-remaining-count"]')).toHaveText('All conflicts resolved');

    await $('[data-testid="btn-mark-resolved"]').click();
    await waitForToast('success');

    // Once staged, the banner and tab disappear — nothing left unmerged.
    await expect($('[data-testid="merge-conflict-banner"]')).not.toBeDisplayed();

    const resolvedContent = readFileSync(join(worktreePath, 'README.md'), 'utf8');
    expect(resolvedContent).not.toContain('<<<<<<<');
    expect(resolvedContent).toContain('main change');

    // "Accept ours" restores content identical to HEAD, so there's no
    // porcelain diff to assert on — check directly that git no longer
    // considers any path unmerged.
    const unmergedFiles = execSync('git diff --name-only --diff-filter=U', { cwd: worktreePath }).toString().trim();
    expect(unmergedFiles).toBe('');

    await assertNoErrors();
  });
});
