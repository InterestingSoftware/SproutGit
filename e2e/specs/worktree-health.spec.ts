import { gotoHash, createTestRepo, closeAndCleanup, monitorErrors } from '../helpers.js';
import { execSync } from 'child_process';
import { writeFileSync, mkdtempSync, rmSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';

describe('worktree health badges', () => {
  let testRepo: string;

  beforeEach(() => {
    testRepo = createTestRepo('health');
  });

  afterEach(async () => {
    await closeAndCleanup(testRepo);
  });

  it('shows a last-commit-age badge on the worktree row', async () => {
    const assertNoErrors = monitorErrors();

    const defaultBranch = execSync('git symbolic-ref --short HEAD', { cwd: testRepo }).toString().trim();

    await gotoHash(`/workspace?path=${encodeURIComponent(testRepo)}`);
    await expect($(`[data-testid="worktree-item"][data-branch="${defaultBranch}"]`)).toBeDisplayed();

    const lastCommitBadge = $(`[data-testid="worktree-item"][data-branch="${defaultBranch}"] [data-testid="worktree-last-commit"]`);
    await expect(lastCommitBadge).toBeDisplayed();
    expect(await lastCommitBadge.getText()).toMatch(/just now|ago/);

    await assertNoErrors();
  });

  it('shows an ahead badge when the worktree has unpushed local commits', async () => {
    const assertNoErrors = monitorErrors();

    // Set up a remote and unpushed local commit *before* opening the
    // workspace — opening converts testRepo's `.git` into a bare root and
    // recreates this branch as a managed worktree, but the conversion
    // reuses the existing `.git` directory, so remotes and upstream
    // tracking configured beforehand survive the migration intact.
    const defaultBranch = execSync('git symbolic-ref --short HEAD', { cwd: testRepo }).toString().trim();
    const remoteDir = mkdtempSync(join(tmpdir(), 'sg-e2e-health-remote-'));
    execSync('git init -q --bare', { cwd: remoteDir });
    execSync(`git remote add origin "${remoteDir}"`, { cwd: testRepo });
    execSync(`git push -q -u origin ${defaultBranch}`, { cwd: testRepo });

    writeFileSync(join(testRepo, 'unpushed.txt'), 'not pushed yet\n');
    execSync('git add unpushed.txt', { cwd: testRepo });
    execSync('git commit -qm "unpushed commit"', { cwd: testRepo });

    try {
      await gotoHash(`/workspace?path=${encodeURIComponent(testRepo)}`);
      await expect($(`[data-testid="worktree-item"][data-branch="${defaultBranch}"]`)).toBeDisplayed();

      const aheadBehindBadge = $(`[data-testid="worktree-item"][data-branch="${defaultBranch}"] [data-testid="worktree-ahead-behind"]`);
      await expect(aheadBehindBadge).toBeDisplayed();
      expect(await aheadBehindBadge.getText()).toContain('1');

      await assertNoErrors();
    } finally {
      rmSync(remoteDir, { recursive: true, force: true });
    }
  });

  it('shows a dirty-file badge when the worktree has uncommitted changes', async () => {
    const assertNoErrors = monitorErrors();

    const defaultBranch = execSync('git symbolic-ref --short HEAD', { cwd: testRepo }).toString().trim();

    await gotoHash(`/workspace?path=${encodeURIComponent(testRepo)}`);
    await expect($(`[data-testid="worktree-item"][data-branch="${defaultBranch}"]`)).toBeDisplayed();

    // Same on-disk path the app itself checks out to for this branch — see
    // commit-workflow.spec.ts for the same pattern.
    writeFileSync(join(testRepo, '.sproutgit', 'worktrees', defaultBranch, 'dirty.txt'), 'uncommitted\n');

    const dirtyBadge = $(`[data-testid="worktree-item"][data-branch="${defaultBranch}"] [data-testid="worktree-dirty-count"]`);
    await expect(dirtyBadge).toBeDisplayed();
    expect(await dirtyBadge.getText()).toBe('1');

    await assertNoErrors();
  });
});
