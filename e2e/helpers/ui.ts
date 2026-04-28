import { basename, dirname } from 'node:path';
import { BrowserPageAdapter, type TauriPage } from '@srsholmes/tauri-playwright';

type AdapterPage = TauriPage | BrowserPageAdapter;

export const DEFAULT_UI_TIMEOUT = 20_000;
const STARTUP_UI_TIMEOUT = 45_000;
const IMPORT_COMPLETION_TIMEOUT = 60_000;
const TOAST_SETTLE_TIMEOUT = 5_000;

const delay = (ms: number) => new Promise(resolveDelay => setTimeout(resolveDelay, ms));

export async function waitForToastMessage(
  tauriPage: AdapterPage,
  type: 'success' | 'error' | 'warning' | 'info',
  messageFragment: string,
  timeout = DEFAULT_UI_TIMEOUT
) {
  const deadline = Date.now() + timeout;

  while (Date.now() < deadline) {
    const messages = await tauriPage.allTextContents(
      `[data-testid="toast-item"][data-toast-type="${type}"] [data-testid="toast-message"]`
    );
    if (messages.some(message => message.includes(messageFragment))) {
      return;
    }
    await delay(120);
  }

  throw new Error(`Timed out waiting for ${type} toast containing: ${messageFragment}`);
}

function isMissingMainWindowError(error: unknown): boolean {
  return error instanceof Error && error.message.includes("window 'main' not found");
}

function isWaitForFunctionTimeout(error: unknown): boolean {
  return error instanceof Error && error.message.includes('waitForFunction timeout');
}

async function safeIsVisible(tauriPage: AdapterPage, selector: string) {
  try {
    return await tauriPage.isVisible(selector);
  } catch (error) {
    if (isMissingMainWindowError(error)) {
      return false;
    }
    throw error;
  }
}

async function waitForMainWindow(tauriPage: AdapterPage, timeout: number) {
  const deadline = Date.now() + timeout;

  while (Date.now() < deadline) {
    try {
      await tauriPage.waitForFunction('document.readyState === "complete"', 1_000);
      return;
    } catch (error) {
      if (!isMissingMainWindowError(error) && !isWaitForFunctionTimeout(error)) {
        throw error;
      }
      await delay(200);
    }
  }

  throw new Error('Main window did not become available for E2E interaction');
}

async function waitForHomeReady(tauriPage: AdapterPage, timeout: number) {
  const deadline = Date.now() + timeout;

  while (Date.now() < deadline) {
    let state: unknown;
    try {
      state = await tauriPage.evaluate(`(() => {
        const importButton = document.querySelector('[data-testid="btn-import"]');
        const main = document.querySelector('main');
        const mainText = main?.textContent ?? '';

        return {
          pathname: window.location.pathname,
          importVisible: importButton instanceof HTMLElement,
          checkingGit: mainText.includes('Checking git'),
        };
      })()`);
    } catch (error) {
      if (!isMissingMainWindowError(error)) {
        throw error;
      }
      await delay(200);
      continue;
    }

    if (
      state &&
      typeof state === 'object' &&
      'pathname' in state &&
      'importVisible' in state &&
      (state as { pathname: string }).pathname === '/' &&
      (state as { importVisible: boolean }).importVisible
    ) {
      return;
    }
    await delay(200);
  }

  throw new Error('Home screen did not finish bootstrapping after reload');
}

async function clearCachedWorkspaceHint(tauriPage: AdapterPage) {
  await tauriPage.evaluate(`(() => {
    sessionStorage.removeItem('sg_workspace_hint');
  })()`);
}

async function waitForOptionalToastMessage(
  tauriPage: AdapterPage,
  type: 'success' | 'error' | 'warning' | 'info',
  messageFragment: string,
  timeout = TOAST_SETTLE_TIMEOUT
) {
  try {
    await waitForToastMessage(tauriPage, type, messageFragment, timeout);
    return true;
  } catch {
    return false;
  }
}

async function performVerifiedReload(tauriPage: AdapterPage) {
  await waitForMainWindow(tauriPage, STARTUP_UI_TIMEOUT);
  await tauriPage.evaluate('window.location.reload()');
  await waitForMainWindow(tauriPage, 15_000);
}

export async function reloadToHome(tauriPage: AdapterPage) {
  for (let attempt = 0; attempt < 2; attempt += 1) {
    try {
      await waitForMainWindow(tauriPage, STARTUP_UI_TIMEOUT);
      await ensureHome(tauriPage);
      await clearCachedWorkspaceHint(tauriPage);
      await performVerifiedReload(tauriPage);
      await waitForHomeReady(tauriPage, STARTUP_UI_TIMEOUT);
      return;
    } catch (error) {
      if (attempt === 1) {
        throw error;
      }
      await delay(250);
    }
  }
}

export async function ensureHome(tauriPage: AdapterPage) {
  const deadline = Date.now() + STARTUP_UI_TIMEOUT;

  while (Date.now() < deadline) {
    if (await safeIsVisible(tauriPage, '[data-testid="btn-import"]')) {
      return;
    }

    if (await safeIsVisible(tauriPage, '[data-testid="btn-back-projects"]')) {
      await tauriPage.getByTestId('btn-back-projects').click();
      await delay(150);
      continue;
    }

    await delay(150);
  }

  throw new Error('ensureHome timeout: home screen never became visibly ready');
}

export async function importRepoViaUi(tauriPage: AdapterPage, repoPath: string) {
  const workspaceParent = dirname(dirname(repoPath));
  const workspaceName = `${basename(repoPath)}-workspace`;

  const waitForWorkspaceShell = async (timeout: number) => {
    const deadline = Date.now() + timeout;
    while (Date.now() < deadline) {
      const headerText = (await tauriPage.textContent('header')) ?? '';
      const backButtonVisible = await safeIsVisible(tauriPage, '[data-testid="btn-back-projects"]');
      const worktreeListVisible = await safeIsVisible(tauriPage, '[data-testid="worktree-list"]');
      const newBranchVisible = await safeIsVisible(tauriPage, '[data-testid="input-new-branch"]');

      if (
        headerText.includes(workspaceName) &&
        backButtonVisible &&
        worktreeListVisible &&
        newBranchVisible
      ) {
        return true;
      }
      await delay(120);
    }
    return false;
  };

  await ensureHome(tauriPage);

  await tauriPage.getByTestId('btn-import').click();
  await tauriPage.getByTestId('import-dialog').waitFor(DEFAULT_UI_TIMEOUT);
  await tauriPage.getByTestId('import-mode-move').click();
  await tauriPage.getByTestId('import-repo-path').fill(repoPath);
  await tauriPage.getByTestId('import-folder-name').fill(workspaceName);
  await tauriPage.getByTestId('import-projects-folder').fill(workspaceParent);

  const submitButton = tauriPage.getByTestId('import-submit');
  await submitButton.waitFor(DEFAULT_UI_TIMEOUT);

  const enableDeadline = Date.now() + DEFAULT_UI_TIMEOUT;
  while (Date.now() < enableDeadline) {
    const disabled = await submitButton.getAttribute('disabled');
    if (!disabled) {
      break;
    }
    await delay(200);
  }

  if (await submitButton.getAttribute('disabled')) {
    throw new Error('Import submit remained disabled after filling import form');
  }

  await tauriPage.evaluate(`(() => {
    const button = document.querySelector('[data-testid="import-submit"]');
    const form = button?.closest('form');
    if (form && 'requestSubmit' in form) {
      form.requestSubmit();
      return;
    }
    button?.click();
  })()`);

  const importDeadline = Date.now() + IMPORT_COMPLETION_TIMEOUT;
  while (Date.now() < importDeadline) {
    if (await waitForWorkspaceShell(600)) {
      // The workspace shell is the authoritative success signal; CI can occasionally miss the
      // success toast even though the import completed and the workspace is fully usable.
      await waitForOptionalToastMessage(
        tauriPage,
        'success',
        `Workspace imported: ${workspaceName}`
      );
      return;
    }

    let importErrorText = '';
    try {
      importErrorText = (await tauriPage.textContent('[data-testid="import-error"]'))?.trim() ?? '';
    } catch {
      // Ignore bridge read failure.
    }

    if (importErrorText) {
      throw new Error(`Import failed: ${importErrorText}`);
    }

    await delay(200);
  }

  throw new Error(
    `Import did not complete within ${IMPORT_COMPLETION_TIMEOUT / 1000}s (workspace shell did not appear)`
  );
}

export async function createWorktreeViaUi(tauriPage: AdapterPage, branchName: string) {
  const delay = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));
  await tauriPage.getByTestId('input-new-branch').fill(branchName);
  const createButton = tauriPage.getByTestId('btn-create-worktree');
  const isDisabled = async () => (await createButton.getAttribute('disabled')) !== null;

  if (await isDisabled()) {
    await tauriPage.getByTestId('input-source-ref').fill('HEAD');
  }

  const enableDeadline = Date.now() + DEFAULT_UI_TIMEOUT;
  while (Date.now() < enableDeadline) {
    if (!(await isDisabled())) {
      break;
    }
    await delay(120);
  }

  if (await isDisabled()) {
    throw new Error('Create worktree button remained disabled after filling branch and source ref');
  }

  await createButton.click();

  const createdSelector = `[data-testid="worktree-item"][data-branch="${branchName}"]`;
  const createdDeadline = Date.now() + DEFAULT_UI_TIMEOUT;

  while (Date.now() < createdDeadline) {
    if (await tauriPage.isVisible(createdSelector)) {
      await waitForToastMessage(tauriPage, 'success', `Worktree created: ${branchName}`);
      return;
    }

    try {
      const toastMessages = await tauriPage.allTextContents(
        '[data-testid="toast-item"][data-toast-type="error"] [data-testid="toast-message"]'
      );
      const latestToast = toastMessages.at(-1)?.trim();
      if (latestToast) {
        throw new Error(`Create worktree failed: ${latestToast}`);
      }
    } catch (error) {
      if (error instanceof Error && error.message.startsWith('Create worktree failed:')) {
        throw error;
      }
      // Ignore intermittent bridge read failures while polling.
    }

    await delay(150);
  }

  throw new Error(`Create worktree timed out: ${branchName}`);
}

export async function openChangesTab(tauriPage: AdapterPage) {
  const tab = tauriPage.getByTestId('tab-changes');
  await tab.waitFor(DEFAULT_UI_TIMEOUT);
  await tab.click();
}

export async function openHistoryTab(tauriPage: AdapterPage) {
  const tab = tauriPage.getByTestId('tab-history');
  await tab.waitFor(DEFAULT_UI_TIMEOUT);
  await tab.click();
}

/** Ensure a worktree is active (selected + tab bar visible) without accidentally toggling it off.
 *
 * The sidebar click handler is a toggle — if the worktree is already active, clicking it
 * deselects it and the tab bar disappears. We handle this by checking active state before
 * clicking, and re-clicking if we detect we accidentally toggled off.
 */
export async function selectWorktreeViaUi(tauriPage: AdapterPage, branchName: string) {
  const delay = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));
  const itemSelector = `[data-testid="worktree-item"][data-branch="${branchName}"]`;
  const tabSelector = '[data-testid="tab-changes"]';
  const item = tauriPage.locator(itemSelector);
  await item.waitFor(DEFAULT_UI_TIMEOUT);

  // Check whether this worktree is already the active one.
  // Use the data-active attribute (present in newer builds) or fall back to the class heuristic.
  const alreadyActive = await tauriPage.evaluate(`(() => {
    const el = document.querySelector('[data-testid="worktree-item"][data-branch="${branchName}"]');
    if (el?.getAttribute('data-active') === 'true') return true;
    return el?.className.includes('text-[var(--sg-primary)]') ?? false;
  })()`);

  if (!alreadyActive) {
    await item.click();
    // Give reactive update a moment.
    await delay(150);
    // If tab bar disappeared we accidentally toggled off an already-active item — re-click.
    if (!(await tauriPage.isVisible(tabSelector))) {
      await item.click();
    }
  }

  // Wait until the tab bar is visible (confirms the worktree is selected).
  const deadline = Date.now() + DEFAULT_UI_TIMEOUT;
  while (Date.now() < deadline) {
    if (await tauriPage.isVisible(tabSelector)) {
      return;
    }
    await delay(120);
  }

  throw new Error(`Tab bar did not appear after selecting worktree: ${branchName}`);
}

/** Delete a worktree by branch name via the hover button and confirm the dialog. */
export async function deleteWorktreeViaUi(tauriPage: AdapterPage, branchName: string) {
  const delay = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

  await tauriPage.evaluate(`(() => {
    const button = document.querySelector('[data-testid="worktree-item"][data-branch="${branchName}"] [data-testid="btn-delete-worktree"]');
    if (!(button instanceof HTMLElement)) {
      throw new Error('delete worktree button not found for ${branchName}');
    }
    button.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
  })()`);

  await tauriPage.getByTestId('confirm-dialog').waitFor(DEFAULT_UI_TIMEOUT);
  await tauriPage.getByTestId('confirm-dialog-confirm').click();

  // Wait until the worktree item disappears.
  const deadline = Date.now() + DEFAULT_UI_TIMEOUT;
  while (Date.now() < deadline) {
    const still = await tauriPage.isVisible(
      `[data-testid="worktree-item"][data-branch="${branchName}"]`
    );
    if (!still) {
      await waitForToastMessage(tauriPage, 'success', `Deleted worktree: ${branchName}`);
      return;
    }
    await delay(120);
  }

  throw new Error(`Worktree item did not disappear after delete: ${branchName}`);
}

/** Stage all unstaged files, fill the commit message, submit, and wait for a success toast.
 *
 * Waits for btn-stage-all to appear before clicking, so callers must ensure they have already
 * switched to the Changes tab and the worktree has at least one unstaged file visible.
 */
export async function stageAndCommitViaUi(tauriPage: AdapterPage, message: string) {
  const delay = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

  await tauriPage.getByTestId('btn-stage-all').waitFor(DEFAULT_UI_TIMEOUT);
  await tauriPage.getByTestId('btn-stage-all').click();

  // Wait for staging to start reflecting in the UI.
  // stage_files is an async Rust invoke, but the commit button enablement below is the real
  // readiness signal, so we only need evidence that the staging transition has begun.
  const stageDeadline = Date.now() + DEFAULT_UI_TIMEOUT;
  while (Date.now() < stageDeadline) {
    const unstagedVisible = await tauriPage.isVisible('[data-testid="unstaged-file"]');
    const stagedVisible = await tauriPage.isVisible('[data-testid="staged-file"]');
    if (!unstagedVisible || stagedVisible) break;
    await delay(120);
  }

  await tauriPage.evaluate(`(() => {
    const field = document.querySelector('[data-testid="commit-message"]');
    if (!(field instanceof HTMLTextAreaElement)) {
      throw new Error('commit-message textarea not found');
    }
    field.value = ${JSON.stringify(message)};
    field.dispatchEvent(new Event('input', { bubbles: true }));
  })()`);

  // Wait for the commit button to actually be enabled.
  // NOTE: getAttribute('disabled') returns "" (empty string) when disabled and null when not;
  // both are falsy in JS so we must compare to null explicitly.
  const commitButton = tauriPage.getByTestId('btn-commit');
  const readyDeadline = Date.now() + DEFAULT_UI_TIMEOUT;
  while (Date.now() < readyDeadline) {
    if ((await commitButton.getAttribute('disabled')) === null) break;
    await delay(120);
  }
  if ((await commitButton.getAttribute('disabled')) !== null) {
    throw new Error('stageAndCommitViaUi: commit button never became enabled');
  }

  await commitButton.click();

  const resultDeadline = Date.now() + DEFAULT_UI_TIMEOUT;
  while (Date.now() < resultDeadline) {
    const successes = await tauriPage.allTextContents(
      '[data-testid="toast-item"][data-toast-type="success"] [data-testid="toast-message"]'
    );
    if (successes.some(t => t.includes(message))) return;

    const errors = await tauriPage.allTextContents(
      '[data-testid="toast-item"][data-toast-type="error"] [data-testid="toast-message"]'
    );
    const err = errors.find(Boolean);
    if (err) throw new Error(`Commit failed: ${err}`);

    await delay(120);
  }

  throw new Error(`Commit did not produce success toast for message: ${message}`);
}
