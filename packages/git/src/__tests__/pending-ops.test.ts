import { describe, it, expect } from 'vitest';
import { trackGitOperation, waitForIdleRepo } from '../pending-ops.js';

function deferred<T>(): { promise: Promise<T>; resolve: (v: T) => void; reject: (e: unknown) => void } {
  let resolve!: (v: T) => void;
  let reject!: (e: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

describe('waitForIdleRepo / trackGitOperation', () => {
  it('resolves immediately when nothing is tracked for the path', async () => {
    const start = Date.now();
    await waitForIdleRepo('/repo/never-tracked');
    expect(Date.now() - start).toBeLessThan(100);
  });

  it('waits until a tracked in-flight operation settles', async () => {
    const op = deferred<void>();
    trackGitOperation('/repo/a', op.promise);

    let idleResolved = false;
    const idle = waitForIdleRepo('/repo/a', 5_000).then(() => { idleResolved = true; });

    await new Promise(r => setTimeout(r, 20));
    expect(idleResolved).toBe(false);

    op.resolve();
    await idle;
    expect(idleResolved).toBe(true);
  });

  it('still counts as settled when the tracked operation rejects', async () => {
    const op = deferred<void>();
    const tracked = trackGitOperation('/repo/b', op.promise);
    tracked.catch(() => undefined); // avoid unhandled rejection noise

    op.reject(new Error('boom'));
    await waitForIdleRepo('/repo/b', 5_000);
    // If we get here without hitting the timeout path, it resolved promptly.
  });

  it('times out rather than waiting forever for a stuck operation', async () => {
    const op = deferred<void>();
    trackGitOperation('/repo/c', op.promise);

    const start = Date.now();
    await waitForIdleRepo('/repo/c', 150);
    expect(Date.now() - start).toBeGreaterThanOrEqual(140);

    op.resolve(); // clean up so nothing lingers past the test
  });

  it('tracks multiple concurrent operations independently — idle only once all settle', async () => {
    const op1 = deferred<void>();
    const op2 = deferred<void>();
    trackGitOperation('/repo/d', op1.promise);
    trackGitOperation('/repo/d', op2.promise);

    let idleResolved = false;
    const idle = waitForIdleRepo('/repo/d', 5_000).then(() => { idleResolved = true; });

    op1.resolve();
    await new Promise(r => setTimeout(r, 20));
    expect(idleResolved).toBe(false); // op2 still pending

    op2.resolve();
    await idle;
    expect(idleResolved).toBe(true);
  });

  it('does not confuse different repo paths', async () => {
    const op = deferred<void>();
    trackGitOperation('/repo/e', op.promise);

    await waitForIdleRepo('/repo/other', 1_000); // unrelated path — should return promptly
    op.resolve();
  });
});
