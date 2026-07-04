import { describe, it, expect, afterEach } from 'vitest';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { watchRecursive, closeWatcher, type RecursiveWatchEvent } from '../recursive-watch.js';

function tempDir(prefix: string): string {
  return mkdtempSync(join(tmpdir(), prefix));
}

function waitFor<T>(check: () => T | undefined, timeoutMs = 5_000, intervalMs = 25): Promise<T> {
  const start = Date.now();
  return new Promise((resolvePromise, reject) => {
    const tick = () => {
      const result = check();
      if (result !== undefined) {
        resolvePromise(result);
        return;
      }
      if (Date.now() - start > timeoutMs) {
        reject(new Error('waitFor() timed out'));
        return;
      }
      setTimeout(tick, intervalMs);
    };
    tick();
  });
}

/**
 * Waits `initialDelayMs` (letting the watcher settle past its
 * ignoreInitial/baseline phase — writing immediately after watchRecursive()
 * returns can otherwise misfire an "add" for a pre-existing file), then
 * repeats `mutate()` on an interval until `check()` returns a defined value
 * or the overall timeout elapses. Native fs.watch (used on macOS/Windows)
 * can occasionally take longer than expected to start observing a freshly
 * created watch under CI load -- retrying the mutation after the initial
 * settle delay is far more reliable than a single write + a long fixed wait.
 */
async function waitForEventRetrying<T>(
  mutate: () => void,
  check: () => T | undefined,
  timeoutMs = 8_000,
  retryIntervalMs = 500,
  initialDelayMs = 300,
): Promise<T> {
  await new Promise(r => setTimeout(r, initialDelayMs));
  const start = Date.now();
  let lastMutate = Date.now();
  mutate();
  return new Promise((resolvePromise, reject) => {
    const tick = () => {
      const result = check();
      if (result !== undefined) {
        resolvePromise(result);
        return;
      }
      const now = Date.now();
      if (now - start > timeoutMs) {
        reject(new Error('waitForEventRetrying() timed out'));
        return;
      }
      if (now - lastMutate >= retryIntervalMs) {
        lastMutate = now;
        mutate();
      }
      setTimeout(tick, 25);
    };
    tick();
  });
}

describe('watchRecursive / closeWatcher', () => {
  const dirsToClean: string[] = [];

  afterEach(() => {
    while (dirsToClean.length > 0) {
      const dir = dirsToClean.pop()!;
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('reports an "add" event when a new file is created under the watched root', async () => {
    const root = tempDir('sg-watch-add-');
    dirsToClean.push(root);

    const events: { event: RecursiveWatchEvent; path: string }[] = [];
    const watcher = watchRecursive(root, (event, path) => {
      events.push({ event, path });
    });

    try {
      const added = await waitForEventRetrying(
        () => writeFileSync(join(root, 'new-file.txt'), 'hello'),
        () => events.find(e => e.event === 'add' && e.path.endsWith('new-file.txt')),
        8_000,
      );
      expect(added.path).toBe(join(root, 'new-file.txt'));
    } finally {
      closeWatcher(watcher);
    }
  }, 15_000);

  it('reports an event for an existing file being modified (without ever reporting it deleted)', async () => {
    // On the native (macOS/Windows) path, an in-place overwrite of an
    // existing file is sometimes reported by the OS as a 'rename' rather
    // than a 'change' event -- since the file still exists when we stat it,
    // watchRecursive's create/delete disambiguation reports that as 'add'
    // rather than 'change'. That distinction is deliberately not chased
    // further here: every real consumer (files.ts's live-sync watcher, via
    // workspace.tsx's onFileChanged) treats 'add' and 'change' identically
    // and only branches on 'unlink' (see workspace.tsx's
    // `if (event.type === 'deleted') return;`), so getting add-vs-change
    // exactly right for an in-place overwrite has no behavioral effect --
    // only "did we get notified, and did we correctly NOT think it was
    // deleted" matters.
    const root = tempDir('sg-watch-change-');
    dirsToClean.push(root);
    const filePath = join(root, 'existing.txt');
    writeFileSync(filePath, 'v1');

    const events: { event: RecursiveWatchEvent; path: string }[] = [];
    const watcher = watchRecursive(root, (event, path) => {
      events.push({ event, path });
    });

    try {
      let attempt = 0;
      const observed = await waitForEventRetrying(
        () => writeFileSync(filePath, `v2 - changed (attempt ${attempt++})`),
        () => events.find(e => (e.event === 'change' || e.event === 'add') && e.path === filePath),
        8_000,
      );
      expect(observed).toBeDefined();
      expect(events.some(e => e.event === 'unlink' && e.path === filePath)).toBe(false);
    } finally {
      closeWatcher(watcher);
    }
  }, 15_000);

  it('reports an "unlink" event when a watched file is deleted', async () => {
    const root = tempDir('sg-watch-unlink-');
    dirsToClean.push(root);
    const filePath = join(root, 'to-delete.txt');
    writeFileSync(filePath, 'bye');

    const events: { event: RecursiveWatchEvent; path: string }[] = [];
    const watcher = watchRecursive(root, (event, path) => {
      events.push({ event, path });
    });

    try {
      // Recreate the file before each retry so a retried mutation always
      // produces a fresh delete event (rather than a no-op rm on an
      // already-deleted file, which wouldn't generate anything to observe).
      const unlinked = await waitForEventRetrying(
        () => {
          writeFileSync(filePath, 'bye again');
          rmSync(filePath, { force: true });
        },
        () => events.find(e => e.event === 'unlink' && e.path === filePath),
        8_000,
      );
      expect(unlinked).toBeDefined();
    } finally {
      closeWatcher(watcher);
    }
  }, 15_000);

  it('respects an `ignored` predicate, never reporting events for matched paths', async () => {
    const root = tempDir('sg-watch-ignored-');
    dirsToClean.push(root);
    mkdirSync(join(root, 'node_modules'));

    const events: { event: RecursiveWatchEvent; path: string }[] = [];
    const watcher = watchRecursive(
      root,
      (event, path) => events.push({ event, path }),
      path => path.split(/[\\/]+/).includes('node_modules'),
    );

    try {
      writeFileSync(join(root, 'node_modules', 'ignored.js'), '');
      // Wait for the tracked file to show up (retrying the write, since the
      // watcher may not be fully up yet), which proves the watcher is alive
      // and had every opportunity to also report the ignored one.
      await waitForEventRetrying(
        () => writeFileSync(join(root, 'tracked.txt'), 'seen'),
        () => events.find(e => e.path.endsWith('tracked.txt')),
        8_000,
      );

      expect(events.some(e => e.path.includes('node_modules'))).toBe(false);
    } finally {
      closeWatcher(watcher);
    }
  }, 15_000);

  // Only the Linux (chokidar) path lazily picks up a root created after
  // watchRecursive() is called. macOS/Windows use native fs.watch, which
  // throws synchronously for a non-existent path — watchRecursive returns
  // null there, matching this project's pre-existing "path may not exist"
  // behavior on those platforms.
  const itOnLinux = process.platform === 'linux' ? it : it.skip;

  itOnLinux('can watch a root that does not exist yet, and later picks up files added under it', async () => {
    const parent = tempDir('sg-watch-lazy-parent-');
    dirsToClean.push(parent);
    const root = join(parent, 'not-yet-created');

    const events: { event: RecursiveWatchEvent; path: string }[] = [];
    const watcher = watchRecursive(root, (event, path) => events.push({ event, path }));

    try {
      // Give chokidar a beat to set up its (currently nonexistent) watch target.
      await new Promise(r => setTimeout(r, 200));
      mkdirSync(root, { recursive: true });
      writeFileSync(join(root, 'appeared.txt'), 'content');

      const added = await waitFor(
        () => events.find(e => e.path.endsWith('appeared.txt')),
        8_000,
      );
      expect(added).toBeDefined();
    } finally {
      closeWatcher(watcher);
    }
  }, 10_000);

  const itOnNativeRecursive = process.platform === 'win32' || process.platform === 'darwin' ? it : it.skip;

  itOnNativeRecursive('returns null (rather than lazily picking up the root) when watching a path that does not exist yet', () => {
    const parent = tempDir('sg-watch-native-missing-parent-');
    dirsToClean.push(parent);
    const root = join(parent, 'not-yet-created');

    const watcher = watchRecursive(root, () => undefined);
    expect(watcher).toBeNull();
    closeWatcher(watcher); // no-ops on null; asserts the guard doesn't throw
  });

  it('closeWatcher() swallows errors thrown synchronously by watcher.close()', () => {
    const throwingWatcher = {
      close: () => {
        throw new Error('boom');
      },
    };
    expect(() => closeWatcher(throwingWatcher)).not.toThrow();
  });

  it('closeWatcher() swallows a rejected promise returned by watcher.close()', async () => {
    const rejectingWatcher = {
      close: () => Promise.reject(new Error('async boom')),
    };
    expect(() => closeWatcher(rejectingWatcher)).not.toThrow();
    // Let the rejection's .catch() run so it doesn't surface as an
    // unhandled rejection in a later test.
    await new Promise(r => setTimeout(r, 50));
  });

  it('closeWatcher() handles a close() that returns void synchronously', () => {
    let closed = false;
    const syncWatcher = { close: () => { closed = true; } };
    expect(() => closeWatcher(syncWatcher)).not.toThrow();
    expect(closed).toBe(true);
  });

  it('stops emitting events after being closed', async () => {
    const root = tempDir('sg-watch-stop-');
    dirsToClean.push(root);

    const events: { event: RecursiveWatchEvent; path: string }[] = [];
    const watcher = watchRecursive(root, (event, path) => events.push({ event, path }));

    // Retry the write (the watcher may not be fully up yet right after
    // watchRecursive() returns) rather than a single write + long fixed wait.
    await waitForEventRetrying(
      () => writeFileSync(join(root, 'before-close.txt'), 'x'),
      () => events.find(e => e.path.endsWith('before-close.txt')),
      8_000,
    );

    closeWatcher(watcher);
    const countAtClose = events.length;

    writeFileSync(join(root, 'after-close.txt'), 'y');
    // No good way to "wait for an absence", so just give it a generous
    // window during which an errant event would have arrived.
    await new Promise(r => setTimeout(r, 500));

    expect(events.length).toBe(countAtClose);
  }, 15_000);
});
