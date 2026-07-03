/**
 * External worktrees: ones registered against the repo by a tool other than
 * SproutGit itself (e.g. Claude Code creating a worktree under
 * `<worktree>/.claude/worktrees`). They show up via `git worktree list
 * --porcelain` from the bare root just like managed worktrees, and the app
 * must treat them as first-class citizens: visible, selectable, removable
 * (without ever deleting their branch), while never retroactively running
 * `after_worktree_create` hooks for them.
 */

import { gotoHash, monitorErrors, waitForToast, closeAndCleanup } from '../helpers.js';
import { execSync } from 'child_process';
import { mkdtempSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';

function createFreshRepo(name: string): string {
  const dir = mkdtempSync(join(tmpdir(), `sg-ext-${name}-`));
  execSync('git init', { cwd: dir });
  execSync('git config user.email "test@example.com"', { cwd: dir });
  execSync('git config user.name "Test"', { cwd: dir });
  writeFileSync(join(dir, 'README.md'), `# ${name}\n`);
  execSync('git add .', { cwd: dir });
  execSync('git commit -m "init: initial commit"', { cwd: dir });
  return dir;
}

async function importAndNavigate(sourceRepoPath: string): Promise<{ workspacePath: string }> {
  const result = (await browser.execute(
    (path: string) => (window as any).api.importWorkspace({ sourceRepoPath: path }),
    sourceRepoPath
  )) as { workspacePath: string };
  await gotoHash(`/workspace?path=${encodeURIComponent(result.workspacePath)}`);
  await expect($('[data-testid="btn-open-create-worktree"]')).toBeDisplayed();
  return result;
}

describe('external worktrees', () => {
  it('shows a worktree registered outside .sproutgit/worktrees as external, and removes it without deleting its branch', async () => {
    const assertNoErrors = monitorErrors();
    const repoDir = createFreshRepo('adopted');
    const externalWtDir = mkdtempSync(join(tmpdir(), 'sg-ext-claude-worktree-'));
    try {
      // Simulate an external tool (e.g. Claude Code) registering its own
      // worktree against the repo before SproutGit ever opens it.
      execSync(`git worktree add -b claude/adopted-feature "${externalWtDir}"`, { cwd: repoDir });

      await importAndNavigate(repoDir);

      // It should render as an external item, not a managed one.
      await expect(
        $('[data-testid="worktree-item-external"][data-branch="claude/adopted-feature"]')
      ).toBeDisplayed();
      await expect(
        $('[data-testid="worktree-item"][data-branch="claude/adopted-feature"]')
      ).not.toBeExisting();

      // It must be selectable like any other worktree.
      await $('[data-testid="worktree-item-external"][data-branch="claude/adopted-feature"]').click();
      await expect($('//*[contains(@class,"sg-tab") and contains(.,"Changes")]')).toBeDisplayed();

      // Remove it via the context menu — dispatch contextmenu directly since
      // CDP pointer actions don't reliably trigger it in Electron.
      await browser.execute((branch: string) => {
        const el = document.querySelector(`[data-testid="worktree-item-external"][data-branch="${branch}"]`) as HTMLElement | null;
        if (!el) throw new Error(`worktree-item-external[data-branch="${branch}"] not found`);
        const rect = el.getBoundingClientRect();
        el.dispatchEvent(new MouseEvent('contextmenu', {
          bubbles: true,
          cancelable: true,
          button: 2,
          clientX: rect.left + rect.width / 2,
          clientY: rect.top + rect.height / 2,
        }));
      }, 'claude/adopted-feature');

      await expect($('[data-testid="context-menu"]')).toBeDisplayed();
      // Adopted worktrees get an opt-in "Run Create Hooks…" action instead of
      // running after_worktree_create hooks retroactively.
      await expect(
        $('[data-testid="context-menu"]').$('.//button[contains(.,"Run Create Hooks…")]')
      ).toBeDisplayed();
      await $('[data-testid="context-menu"]')
        .$('.//button[contains(.,"Remove Worktree")]')
        .click();

      // The confirmation dialog must call out that the branch will survive.
      await expect($('[data-testid="btn-confirm-delete-worktree"]')).toBeDisplayed();
      await expect($('//p[contains(.,"will not be deleted")]')).toBeDisplayed();
      await $('[data-testid="btn-confirm-delete-worktree"]').click();

      await expect(
        $('[data-testid="worktree-item-external"][data-branch="claude/adopted-feature"]')
      ).not.toBeDisplayed();
      await waitForToast('success');

      // The branch itself must still exist — an external tool owns it.
      // repoDir's `.git` was converted to a bare root at import time, so
      // read refs from there rather than repoDir itself.
      const branches = execSync('git branch --list claude/adopted-feature', {
        cwd: join(repoDir, '.sproutgit', 'root'),
      }).toString();
      expect(branches).toContain('claude/adopted-feature');

      await assertNoErrors();
    } finally {
      await closeAndCleanup(repoDir);
    }
  });
});
