import { basename, dirname } from 'node:path';
import {
  BrowserPageAdapter,
  type TauriPage,
} from '@srsholmes/tauri-playwright';

type AdapterPage = TauriPage | BrowserPageAdapter;

export const DEFAULT_UI_TIMEOUT = 3_000;
const STARTUP_UI_TIMEOUT = 30_000;
const IMPORT_COMPLETION_TIMEOUT = 3_000;

async function getBootMarkerText(tauriPage: AdapterPage) {
  return ((await tauriPage.textContent('[data-testid="e2e-run-watermark"]')) ?? '').trim();
}

async function waitForBootMarkerChange(
  tauriPage: AdapterPage,
  previousText: string,
  timeout: number,
) {
  const deadline = Date.now() + timeout;

  while (Date.now() < deadline) {
    const nextText = await getBootMarkerText(tauriPage);
    if (nextText && nextText !== previousText) {
      return nextText;
    }
    await new Promise(resolveDelay => setTimeout(resolveDelay, 100));
  }

  throw new Error('Reload did not produce a new visible boot marker');
}

async function waitForHomeReady(tauriPage: AdapterPage, timeout: number) {
  const deadline = Date.now() + timeout;

  while (Date.now() < deadline) {
    const state = await tauriPage.evaluate(`(() => {
      const importButton = document.querySelector('[data-testid="btn-import"]');
      const main = document.querySelector('main');
      const mainText = main?.textContent ?? '';

      return {
        pathname: window.location.pathname,
        importVisible: importButton instanceof HTMLElement,
        checkingGit: mainText.includes('Checking git'),
      };
    })()`);

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

    await new Promise(resolveDelay => setTimeout(resolveDelay, 200));
  }

  throw new Error('Home screen did not finish bootstrapping after reload');
}

async function clearRecentProjects(tauriPage: AdapterPage) {
  const deadline = Date.now() + STARTUP_UI_TIMEOUT;

  while (Date.now() < deadline) {
    const removed = await tauriPage.evaluate(`(() => {
      const button = document.querySelector('[data-testid="recent-project-remove"]');
      if (!(button instanceof HTMLElement)) {
        return false;
      }
      button.click();
      return true;
    })()`);

    if (!removed) {
      return;
    }

    await new Promise(resolveDelay => setTimeout(resolveDelay, 120));
  }

  throw new Error('Timed out while clearing recent projects during E2E reset');
}

async function performVerifiedReload(tauriPage: AdapterPage) {
  const previousBootMarker = await getBootMarkerText(tauriPage);
  await tauriPage.evaluate('window.location.reload()');
  await tauriPage.waitForFunction('document.readyState === "complete"', 5_000);
  await waitForBootMarkerChange(tauriPage, previousBootMarker, 5_000);
}

export async function reloadToHome(tauriPage: AdapterPage) {
  for (let attempt = 0; attempt < 2; attempt += 1) {
    const backVisible = await tauriPage.isVisible('[data-testid="btn-back-projects"]');
    const workspaceVisible =
      backVisible ||
      (await tauriPage.isVisible('[data-testid="worktree-list"]')) ||
      (await tauriPage.isVisible('[data-testid="tab-history"]')) ||
      (await tauriPage.isVisible('[data-testid="input-new-branch"]'));

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
      (await tauriPage.isVisible('[data-testid="commit-row"]')) &&
      !(await tauriPage.isVisible('[data-testid="btn-back-projects"]'));

    if (commitGraphStillVisible) {
      await tauriPage.evaluate('window.location.reload()');
      await tauriPage.waitForFunction('document.readyState === "complete"', 5_000);
    }

    try {
      await ensureHome(tauriPage);
      await waitForHomeReady(tauriPage, STARTUP_UI_TIMEOUT);
      await clearRecentProjects(tauriPage);
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
    if (await tauriPage.isVisible('[data-testid="btn-import"]')) {
      return;
    }

    if (await tauriPage.isVisible('[data-testid="btn-back-projects"]')) {
      await tauriPage.getByTestId('btn-back-projects').click();
      await new Promise(resolveDelay => setTimeout(resolveDelay, 150));
      continue;
    }

    await new Promise(resolveDelay => setTimeout(resolveDelay, 150));
  }

  throw new Error('ensureHome timeout: home screen never became visibly ready');
}

export async function importRepoViaUi(tauriPage: AdapterPage, repoPath: string) {
  const workspaceParent = dirname(dirname(repoPath));
  const workspaceName = `${basename(repoPath)}-workspace`;
  const delay = (ms: number) => new Promise((resolveDelay) => setTimeout(resolveDelay, ms));

  const waitForWorkspaceHeader = async (timeout: number) => {
    const deadline = Date.now() + timeout;
    while (Date.now() < deadline) {
      const headerText = (await tauriPage.textContent('header')) ?? '';
      if (headerText.includes(workspaceName)) {
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

  // Fast-path: most successful imports reach workspace view quickly.
  try {
    await tauriPage.getByTestId('btn-back-projects').waitFor(1_200);
    if (await waitForWorkspaceHeader(DEFAULT_UI_TIMEOUT)) {
      return;
    }
  } catch {
    // Continue with bounded state polling below.
  }

  // Enforce strict cap on total import wait time.
  await delay(IMPORT_COMPLETION_TIMEOUT - 1_200);

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
  throw new Error('Import did not complete within 3s (workspace header did not appear)');
}

export async function createWorktreeViaUi(tauriPage: AdapterPage, branchName: string) {
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
    await new Promise(resolve => setTimeout(resolve, 120));
  }

  if (await isDisabled()) {
    throw new Error('Create worktree button remained disabled after filling branch and source ref');
  }

  await createButton.click();
  await tauriPage.locator(`[data-testid="worktree-item"][data-branch="${branchName}"]`).waitFor(DEFAULT_UI_TIMEOUT);
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