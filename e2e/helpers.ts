import { mkdtempSync, rmSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { execSync } from 'child_process';

/** 15-second baseline for element assertions (matches waitforTimeout in wdio.conf.ts). */
export const E2E_TIMEOUT_MS = 15_000;

/**
 * Navigate to a hash route inside the already-loaded Electron page.
 * Manipulates location directly (same as the old Playwright helper) and waits
 * one tick for TanStack Router to process the hashchange.
 */
export async function gotoHash(hash: string): Promise<void> {
  await browser.execute((h: string) => {
    window.location.hash = h;
  }, hash);
  await browser.pause(200);
}

/** Navigate back to the home route. */
export async function goHome(): Promise<void> {
  await gotoHash('/');
}

/** Bootstrap a minimal git repo with one commit and return its path. */
export function createTestRepo(name = 'repo'): string {
  const dir = mkdtempSync(join(tmpdir(), `sg-e2e-${name}-`));
  execSync('git init', { cwd: dir });
  execSync('git config user.email "test@example.com"', { cwd: dir });
  execSync('git config user.name "Test User"', { cwd: dir });
  execSync('echo "# test" > README.md', { cwd: dir });
  execSync('git add .', { cwd: dir });
  execSync('git commit -m "init"', { cwd: dir });
  return dir;
}

const RETRYABLE_RM_CODES = new Set(['EBUSY', 'EPERM', 'ENOTEMPTY', 'EMFILE', 'ENFILE']);

function delay(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

/**
 * Removes `dir` recursively, retrying on Windows-specific transient lock
 * errors with linear backoff.
 *
 * Written as our own explicit loop — rather than `rmSync`'s built-in
 * `maxRetries`/`retryDelay` options — because CI showed the built-in option
 * failing after a single attempt with no observable delay (the very next
 * WebDriver command fired ~15ms later, far short of even one retryDelay),
 * which doesn't match the documented behavior and couldn't be verified
 * locally (Node 22, the version CI runs, wasn't reproducible in this
 * sandbox). `rmFn` is injectable so this loop's actual retry behavior can
 * be unit tested without depending on real OS-level file locking.
 */
export async function rmWithRetry(
  dir: string,
  { maxRetries = 20, retryDelayMs = 250, rmFn = rmSync }:
    { maxRetries?: number; retryDelayMs?: number; rmFn?: typeof rmSync } = {}
): Promise<void> {
  for (let attempt = 0; ; attempt++) {
    try {
      rmFn(dir, { recursive: true, force: true });
      return;
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code;
      if (!code || !RETRYABLE_RM_CODES.has(code) || attempt >= maxRetries) throw error;
      await delay(retryDelayMs * (attempt + 1));
    }
  }
}

/**
 * Remove a temporary repo directory.
 *
 * `closeAndCleanup` already closes the sqlite connection, stops the fs.watch
 * handles, and awaits any git command still in flight against the repo
 * before this runs — so by the time we get here, nothing left in *our*
 * process should be holding root open. What can still transiently lock a
 * just-written bare repo's files on Windows CI is antivirus real-time
 * scanning, which is external to the app and only observable as EBUSY/EPERM
 * clearing after a delay — hence the retry.
 */
export async function cleanupRepo(dir: string): Promise<void> {
  await rmWithRetry(dir);
}

/**
 * Navigate home, close a workspace's SQLite DB in the main process, and
 * delete its directory.
 *
 * Order matters here: navigate home *first* so the workspace route
 * unmounts and every query/watcher tied to its lifecycle (useWorktrees,
 * useCommits, the fs.watch handles, ...) actually stops. Calling
 * closeWorkspace() before navigating away leaves the component fully
 * mounted and live — closeWorkspace()'s wait for in-flight git operations
 * can complete, return, and then a query still tied to the (still-mounted)
 * component fires a *new* one it never saw, which can still be running
 * when cleanupRepo() deletes the directory out from under it.
 */
export async function closeAndCleanup(workspacePath: string): Promise<void> {
  await goHome();
  // browser.execute() does NOT await Promises — use executeAsync so the
  // WebDriver call blocks until the IPC round-trip actually completes and
  // the SQLite connection is closed before we attempt to delete on Windows.
  await browser.executeAsync(
    (p: string, done: (err?: string) => void) => {
      (window as unknown as { api: { closeWorkspace: (path: string) => Promise<void> } })
        .api.closeWorkspace(p)
        .then(() => done(), (e: unknown) => done(String(e)));
    },
    workspacePath
  );
  await cleanupRepo(workspacePath);
}

// ── Toast helpers ─────────────────────────────────────────────────────────────

/** Wait for a toast with the given variant to appear. */
export async function waitForToast(variant: 'success' | 'error' | 'info'): Promise<void> {
  await expect(
    $(`[data-testid="toast"][data-toast-variant="${variant}"]`)
  ).toBeDisplayed({ message: `Expected a "${variant}" toast to appear` });
}

/**
 * Install a MutationObserver in the renderer that records every error toast
 * text that appears during the test. Call the returned function at the end of
 * the test to assert no unexpected error toasts were shown.
 *
 * Usage:
 *   const assertNoErrors = monitorErrors();
 *   // ... test body ...
 *   await assertNoErrors();
 */
export function monitorErrors(): () => Promise<void> {
  void browser.execute(() => {
    // Use a namespaced key so monitors from different tests don't clash.
    (window as unknown as Record<string, unknown>)['__sgErrorToasts'] = [];
    const observer = new MutationObserver(mutations => {
      for (const mutation of mutations) {
        for (const node of Array.from(mutation.addedNodes)) {
          if (node instanceof HTMLElement) {
            const toasts = [
              ...(node.matches('[data-toast-variant="error"]') ? [node] : []),
              ...Array.from(node.querySelectorAll('[data-toast-variant="error"]')),
            ];
            for (const t of toasts) {
              ((window as unknown as Record<string, unknown>)['__sgErrorToasts'] as string[])
                .push(t.textContent?.trim() ?? '');
            }
          }
        }
      }
    });
    observer.observe(document.body, { childList: true, subtree: true });
    (window as unknown as Record<string, unknown>)['__sgErrorObserver'] = observer;
  });

  return async () => {
    const errors = await browser.execute(() => {
      const obs = (window as unknown as Record<string, unknown>)['__sgErrorObserver'] as MutationObserver | undefined;
      obs?.disconnect();
      return ((window as unknown as Record<string, unknown>)['__sgErrorToasts'] as string[] | undefined) ?? [];
    }) as string[];

    if (errors.length > 0) {
      throw new Error(
        `Unexpected error toast(s) appeared:\n  ${errors.map(m => `• ${m}`).join('\n  ')}`
      );
    }
  };
}
