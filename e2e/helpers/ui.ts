import { basename, dirname } from 'node:path';
import {
  BrowserPageAdapter,
  type TauriPage,
} from '@srsholmes/tauri-playwright';

type AdapterPage = TauriPage | BrowserPageAdapter;

export const DEFAULT_UI_TIMEOUT = 20_000;
const STARTUP_UI_TIMEOUT = 30_000;
const IMPORT_COMPLETION_TIMEOUT = DEFAULT_UI_TIMEOUT;

const delay = (ms: number) => new Promise(resolveDelay => setTimeout(resolveDelay, ms));

function isMissingMainWindowError(error: unknown): boolean {
  return error instanceof Error && error.message.includes("window 'main' not found");
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
      if (!isMissingMainWindowError(error)) {
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

async function performVerifiedReload(tauriPage: AdapterPage) {
  await waitForMainWindow(tauriPage, STARTUP_UI_TIMEOUT);
  await tauriPage.evaluate('window.location.reload()');
  await waitForMainWindow(tauriPage, 5_000);
}

export async function reloadToHome(tauriPage: AdapterPage) {
  await waitForMainWindow(tauriPage, STARTUP_UI_TIMEOUT);

  for (let attempt = 0; attempt < 2; attempt += 1) {
    const backVisible = await safeIsVisible(tauriPage, '[data-testid="btn-back-projects"]');
    const workspaceVisible =
      backVisible ||
      (await safeIsVisible(tauriPage, '[data-testid="worktree-list"]')) ||
      (await safeIsVisible(tauriPage, '[data-testid="tab-history"]')) ||
      (await safeIsVisible(tauriPage, '[data-testid="input-new-branch"]'));

    if (workspaceVisible) {
      if (backVisible) {
        await tauriPage.getByTestId('btn-back-projects').click();
      } else {
        await tauriPage.goBack();
      }

      await tauriPage.waitForFunction(`(() => {
        const importBtn = document.querySelector('[data-testid="btn-import"]');
        return window.location.pathname === '/' && importBtn instanceof HTMLElement;
      })()`, 3_000);
    }

    await performVerifiedReload(tauriPage);

    const commitGraphStillVisible =
      (await safeIsVisible(tauriPage, '[data-testid="commit-row"]')) &&
      !(await safeIsVisible(tauriPage, '[data-testid="btn-back-projects"]'));

    if (commitGraphStillVisible) {
      await tauriPage.evaluate('window.location.reload()');
      await waitForMainWindow(tauriPage, 5_000);
    }

    try {
      await ensureHome(tauriPage);
      await clearCachedWorkspaceHint(tauriPage);
      await performVerifiedReload(tauriPage);
      await waitForHomeReady(tauriPage, STARTUP_UI_TIMEOUT);
      return;
    } catch (error) {
      if (attempt === 1) {
        throw error;
      }
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

      if (headerText.includes(workspaceName) && backButtonVisible && worktreeListVisible && newBranchVisible) {
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
      return;
    }

    let importErrorText = '';
    try {
      importErrorText =
        (await tauriPage.textContent('[data-testid="import-error"]'))?.trim() ?? '';
    } catch {
      // Ignore bridge read failure.
    }

    if (importErrorText) {
      throw new Error(`Import failed: ${importErrorText}`);
    }

    await delay(200);
  }

  throw new Error(
    `Import did not complete within ${IMPORT_COMPLETION_TIMEOUT / 1000}s (workspace shell did not appear)`,
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
      return;
    }

    try {
      const toastMessages = await tauriPage.allTextContents(
        '[data-testid="toast-item"][data-toast-type="error"] [data-testid="toast-message"]',
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