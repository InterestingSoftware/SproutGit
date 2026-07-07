import { execSync } from 'child_process';
import { mkdtempSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { gotoHash, monitorErrors, closeAndCleanup } from '../helpers.js';

/**
 * Command palette (Cmd/Ctrl+K): opening, fuzzy filtering, keyboard selection,
 * and a couple of the higher-value actions it exposes (jump to worktree,
 * open settings).
 */

/** Bootstrap a fresh git repo with one commit and return its path. */
function createFreshRepo(name: string): string {
  const dir = mkdtempSync(join(tmpdir(), `sg-palette-${name}-`));
  execSync('git init', { cwd: dir });
  execSync('git config user.email "test@example.com"', { cwd: dir });
  execSync('git config user.name "Test"', { cwd: dir });
  writeFileSync(join(dir, 'README.md'), `# ${name}\n`);
  execSync('git add .', { cwd: dir });
  execSync('git commit -m "init: initial commit"', { cwd: dir });
  return dir;
}

/** Import a repo via the API and navigate to its workspace view. */
async function importAndNavigate(sourceRepoPath: string): Promise<{ workspacePath: string; worktreesPath: string }> {
  const result = (await browser.execute(
    (path: string) => (window as any).api.importWorkspace({ sourceRepoPath: path }),
    sourceRepoPath
  )) as { workspacePath: string; worktreesPath: string };
  await gotoHash(`/workspace?path=${encodeURIComponent(result.workspacePath)}`);
  await expect($('[data-testid="btn-open-create-worktree"]')).toBeDisplayed();
  return result;
}

async function createWorktree(branchName: string): Promise<void> {
  await $('[data-testid="btn-open-create-worktree"]').click();
  await expect($('[data-testid="input-new-branch"]')).toBeDisplayed();
  await $('[data-testid="input-new-branch"]').setValue(branchName);
  await $('[data-testid="btn-create-worktree"]').click();
  await expect($(`[data-testid="worktree-item"][data-branch="${branchName}"]`)).toBeDisplayed();
}

const modifier = process.platform === 'darwin' ? 'Meta' : 'Control';

describe('command palette', () => {
  let repoDir: string;

  beforeEach(() => {
    repoDir = createFreshRepo('cmdk');
  });

  afterEach(async () => {
    await closeAndCleanup(repoDir);
  });

  it('opens with Cmd/Ctrl+K and closes with Escape', async () => {
    const assertNoErrors = monitorErrors();
    await importAndNavigate(repoDir);

    await expect($('[data-testid="command-palette"]')).not.toBeDisplayed();

    await browser.keys([modifier, 'k']);
    await expect($('[data-testid="command-palette"]')).toBeDisplayed();
    await expect($('[data-testid="command-palette-input"]')).toBeDisplayed();

    await browser.keys(['Escape']);
    await expect($('[data-testid="command-palette"]')).not.toBeDisplayed();

    await assertNoErrors();
  });

  it('filters commands as you type and opens Settings on Enter', async () => {
    const assertNoErrors = monitorErrors();
    await importAndNavigate(repoDir);

    await browser.keys([modifier, 'k']);
    await expect($('[data-testid="command-palette"]')).toBeDisplayed();

    await $('[data-testid="command-palette-input"]').setValue('open settings');
    await expect($('[data-testid="command-palette-item"]')).toHaveText('Open Settings');

    await browser.keys(['Enter']);
    await expect($('[data-testid="command-palette"]')).not.toBeDisplayed();
    await expect($('[data-testid="settings-page"]')).toBeDisplayed();

    await assertNoErrors();
  });

  it('jumps to a worktree selected from the palette', async () => {
    const assertNoErrors = monitorErrors();
    await importAndNavigate(repoDir);
    // Capture the initial (default) branch name before adding a second worktree.
    const mainBranch = await $('[data-testid="worktree-item"]').getAttribute('data-branch');
    await createWorktree('feature/cmdk-jump');

    // Newly-created worktrees auto-activate — switch back to main first so
    // the palette selection is a real, observable change.
    await $(`[data-testid="worktree-item"][data-branch="${mainBranch}"]`).click();
    await expect($('[data-testid="worktree-item"][data-branch="feature/cmdk-jump"]'))
      .toHaveAttribute('data-active', 'false');

    await browser.keys([modifier, 'k']);
    await $('[data-testid="command-palette-input"]').setValue('cmdk-jump');
    const switchItem = $('//*[@data-testid="command-palette-item" and contains(.,"Switch to feature/cmdk-jump")]');
    await expect(switchItem).toBeDisplayed();
    await switchItem.click();

    await expect($('[data-testid="command-palette"]')).not.toBeDisplayed();
    await expect($('[data-testid="worktree-item"][data-branch="feature/cmdk-jump"]'))
      .toHaveAttribute('data-active', 'true');

    await assertNoErrors();
  });

  it('shows "No matching commands" for a query with no match', async () => {
    const assertNoErrors = monitorErrors();
    await importAndNavigate(repoDir);

    await browser.keys([modifier, 'k']);
    await $('[data-testid="command-palette-input"]').setValue('zzzznonexistentcommandzzzz');
    await expect($('[data-testid="command-palette-item"]')).not.toBeDisplayed();
    const paletteText = await $('[data-testid="command-palette"]').getText();
    expect(paletteText).toContain('No matching commands');

    await browser.keys(['Escape']);
    await assertNoErrors();
  });
});
