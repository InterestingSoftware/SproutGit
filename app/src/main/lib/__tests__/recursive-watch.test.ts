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
      // Give chokidar a moment to finish its initial scan before writing.
      await new Promise(r => setTimeout(r, 200));
      writeFileSync(join(root, 'new-file.txt'), 'hello');

      const added = await waitFor(() => events.find(e => e.event === 'add' && e.path.endsWith('new-file.txt')), 8_000);
      expect(added.path).toBe(join(root, 'new-file.txt'));
    } finally {
      closeWatcher(watcher);
    }
  }, 15_000);

  it('reports a "change" event when an existing file is modified', async () => {
    const root = tempDir('sg-watch-change-');
    dirsToClean.push(root);
    const filePath = join(root, 'existing.txt');
    writeFileSync(filePath, 'v1');

    const events: { event: RecursiveWatchEvent; path: string }[] = [];
    const watcher = watchRecursive(root, (event, path) => {
      events.push({ event, path });
    });

    try {
      // Give chokidar a moment to establish its baseline (ignoreInitial: true
      // means the initial add for this pre-existing file must not surface).
      await new Promise(r => setTimeout(r, 300));
      writeFileSync(filePath, 'v2 - changed');

      const changed = await waitFor(() => events.find(e => e.event === 'change' && e.path === filePath), 8_000);
      expect(changed).toBeDefined();
      // ignoreInitial: true means the pre-existing file must not have been
      // reported as newly "add"-ed once watching started.
      expect(events.some(e => e.event === 'add' && e.path === filePath)).toBe(false);
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
      await new Promise(r => setTimeout(r, 300));
      rmSync(filePath);

      const unlinked = await waitFor(() => events.find(e => e.event === 'unlink' && e.path === filePath), 8_000);
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
      // Let chokidar finish its initial scan before writing — under load
      // (e.g. the full suite running many test files in parallel) writing
      // immediately can race the watcher's setup.
      await new Promise(r => setTimeout(r, 200));
      writeFileSync(join(root, 'node_modules', 'ignored.js'), '');
      writeFileSync(join(root, 'tracked.txt'), 'seen');

      // Wait for the tracked file to show up, which proves the watcher is
      // alive and had every opportunity to also report the ignored one.
      await waitFor(() => events.find(e => e.path.endsWith('tracked.txt')), 8_000);

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

    // Let chokidar finish its initial scan before writing, same as the
    // other tests in this file — writing immediately after watchRecursive()
    // returns races chokidar's setup and can make the first event slow to
    // arrive (or in the worst case, missed).
    await new Promise(r => setTimeout(r, 200));
    writeFileSync(join(root, 'before-close.txt'), 'x');
    await waitFor(() => events.find(e => e.path.endsWith('before-close.txt')), 8_000);

    closeWatcher(watcher);
    const countAtClose = events.length;

    writeFileSync(join(root, 'after-close.txt'), 'y');
    // No good way to "wait for an absence", so just give it a generous
    // window during which an errant event would have arrived.
    await new Promise(r => setTimeout(r, 500));

    expect(events.length).toBe(countAtClose);
  }, 15_000);
});
