/**
 * Onboarding walkthrough (#87): the home-screen first-run tour and the
 * teaching empty state in the worktree sidebar.
 *
 * The tour never auto-launches in E2E (see api.isE2E in
 * app/src/renderer/routes/index.tsx) — each spec file gets its own fresh
 * Electron launch with an empty config db, so the "first run, no recents"
 * condition that triggers the tour would otherwise be true on literally
 * every spec file's home screen, stealing the first click from any spec
 * that interacts with home right after launch (e.g. import-workflow,
 * new-from-idea-workflow). Coverage here drives the tour explicitly via the
 * "Replay walkthrough" button instead.
 */

import { execSync } from 'child_process';
import { mkdtempSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { goHome, gotoHash, monitorErrors, closeAndCleanup, cleanupRepo } from '../helpers.js';

const HOME_TOUR_SETTING_KEY = 'onboardingHomeTourDismissed';

async function clearTourDismissal(): Promise<void> {
  await browser.executeAsync((key: string, done: (err?: string) => void) => {
    (window as unknown as { api: { deleteSetting: (k: string) => Promise<void> } })
      .api.deleteSetting(key)
      .then(() => done(), (e: unknown) => done(String(e)));
  }, HOME_TOUR_SETTING_KEY);
}

async function readTourDismissal(): Promise<string | null> {
  return browser.executeAsync((key: string, done: (v: string | null) => void) => {
    (window as unknown as { api: { getSetting: (k: string) => Promise<string | null> } })
      .api.getSetting(key)
      .then(done, () => done(null));
  }, HOME_TOUR_SETTING_KEY) as Promise<string | null>;
}

/**
 * The tour's onDestroyed hook writes the dismissal setting via a
 * fire-and-forget `void api.setSetting(...)` (see homeTour.ts) — it doesn't
 * block the click that triggered it. Poll instead of reading once so this
 * doesn't race the IPC round-trip.
 */
async function expectTourDismissalPersisted(): Promise<void> {
  await browser.waitUntil(async () => (await readTourDismissal()) === '1', {
    timeout: 5000,
    timeoutMsg: 'expected the tour dismissal setting to be persisted',
  });
}

/** Bootstrap a fresh git repo with one commit and return its path. */
function createFreshRepo(name: string): string {
  const dir = mkdtempSync(join(tmpdir(), `sg-onboarding-${name}-`));
  execSync('git init', { cwd: dir });
  execSync('git config user.email "test@example.com"', { cwd: dir });
  execSync('git config user.name "Test"', { cwd: dir });
  writeFileSync(join(dir, 'README.md'), `# ${name}\n`);
  execSync('git add .', { cwd: dir });
  execSync('git commit -m "init: initial commit"', { cwd: dir });
  return dir;
}

/**
 * Clone a local repo into a brand-new workspace and navigate to it.
 *
 * Deliberately NOT importWorkspace() — import always recreates the source's
 * checked-out branch as a managed worktree (see importInPlace in
 * app/src/main/ipc/workspace-init.ts), so an imported workspace never
 * actually has zero worktrees. A cloned/newly-created workspace does, until
 * the user makes one — that's the real moment this empty state is for.
 */
async function cloneAndNavigate(sourceRepoPath: string, workspacePath: string): Promise<void> {
  await browser.execute(
    (ws: string, url: string) => (window as any).api.createWorkspace({ workspacePath: ws, repoUrl: url }),
    workspacePath,
    sourceRepoPath
  );
  await gotoHash(`/workspace?path=${encodeURIComponent(workspacePath)}`);
  await expect($('[data-testid="btn-open-create-worktree"]')).toBeDisplayed();
}

describe('onboarding walkthrough', () => {
  it('steps through the home tour and persists dismissal on "Got it"', async () => {
    const assertNoErrors = monitorErrors();
    await goHome();
    await clearTourDismissal();

    await expect($('[data-testid="btn-replay-tour"]')).toBeDisplayed();
    await $('[data-testid="btn-replay-tour"]').click();

    await expect($('.driver-popover-title')).toHaveText('Start with a workspace');
    await $('.driver-popover-next-btn').click();

    await expect($('.driver-popover-title')).toHaveText('Come back anytime');
    await $('.driver-popover-next-btn').click();

    await expect($('.driver-popover-title')).toHaveText('Then: worktrees + agents');
    await expect($('.driver-popover-done-btn')).toBeDisplayed();
    await $('.driver-popover-done-btn').click();

    await expect($('.driver-popover')).not.toBeExisting();
    await expectTourDismissalPersisted();
    await assertNoErrors();
  });

  it('counts an early close as seen too', async () => {
    const assertNoErrors = monitorErrors();
    await goHome();
    await clearTourDismissal();

    await $('[data-testid="btn-replay-tour"]').click();
    await expect($('.driver-popover')).toBeDisplayed();
    await $('.driver-popover-close-btn').click();

    await expect($('.driver-popover')).not.toBeExisting();
    await expectTourDismissalPersisted();
    await assertNoErrors();
  });

  it('teaches the worktree-first model in the empty worktree sidebar', async () => {
    const assertNoErrors = monitorErrors();
    const sourceRepo = createFreshRepo('empty-state');
    const workspacePath = mkdtempSync(join(tmpdir(), 'sg-onboarding-empty-state-ws-'));
    try {
      await cloneAndNavigate(sourceRepo, workspacePath);

      const emptyState = $('[data-testid="worktree-empty-state"]');
      await expect(emptyState).toBeDisplayed();
      await expect(emptyState).toHaveText(/isolated working copy/);
      await expect(emptyState).toHaveText(/Launch an AI agent right inside it/);

      await $('[data-testid="btn-create-first-worktree"]').click();
      await expect($('[data-testid="input-new-branch"]')).toBeDisplayed();
      await assertNoErrors();
    } finally {
      await closeAndCleanup(workspacePath);
      await cleanupRepo(sourceRepo);
    }
  });
});
