import { describe, it, expect } from 'vitest';
import { withWorktreeLock, _getWorktreeLockMapSizeForTests } from '../worktree-lock.js';

function deferred<T>(): { promise: Promise<T>; resolve: (v: T) => void; reject: (e: unknown) => void } {
  let resolve!: (v: T) => void;
  let reject!: (e: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

// A macrotask boundary guarantees every microtask queued up to this point —
// including the lock's internal cleanup/delete chain — has run, unlike
// `await Promise.resolve()` which only advances one tick at a time.
function flushMicrotasks(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 0));
}

describe('withWorktreeLock', () => {
  it('serializes calls against the same repo path — the second waits for the first to settle', async () => {
    const order: string[] = [];
    const first = deferred<void>();

    const call1 = withWorktreeLock('/repo/a', async () => {
      order.push('1-start');
      await first.promise;
      order.push('1-end');
    });

    // Give call1's executor a tick to actually start before queuing call2.
    await Promise.resolve();

    const call2 = withWorktreeLock('/repo/a', async () => {
      order.push('2-start');
    });

    // call2's body must not have started yet — it's queued behind call1.
    await Promise.resolve();
    await Promise.resolve();
    expect(order).toEqual(['1-start']);

    first.resolve();
    await Promise.all([call1, call2]);

    expect(order).toEqual(['1-start', '1-end', '2-start']);
  });

  it('does not serialize calls against different repo paths', async () => {
    const order: string[] = [];
    const first = deferred<void>();

    const call1 = withWorktreeLock('/repo/a', async () => {
      order.push('a-start');
      await first.promise;
      order.push('a-end');
    });
    await Promise.resolve();

    const call2 = withWorktreeLock('/repo/b', async () => {
      order.push('b-start');
    });

    await call2;
    expect(order).toContain('b-start');
    expect(order.indexOf('b-start')).toBeLessThan(order.indexOf('a-end') === -1 ? Infinity : order.indexOf('a-end'));

    first.resolve();
    await call1;
  });

  it('a rejected call does not break the queue for subsequent calls on the same repo', async () => {
    await expect(
      withWorktreeLock('/repo/c', async () => {
        throw new Error('boom');
      })
    ).rejects.toThrow('boom');

    // A later call against the same key must still run normally.
    const result = await withWorktreeLock('/repo/c', async () => 'ok');
    expect(result).toBe('ok');
  });

  it('propagates the resolved value and the specific rejection of the wrapped function', async () => {
    await expect(withWorktreeLock('/repo/d', async () => 42)).resolves.toBe(42);
    await expect(withWorktreeLock('/repo/d', async () => {
      throw new Error('specific failure');
    })).rejects.toThrow('specific failure');
  });

  it('does not retain a map entry once its chain has fully settled', async () => {
    await withWorktreeLock('/repo/leak-single', async () => undefined);
    await flushMicrotasks();

    expect(_getWorktreeLockMapSizeForTests()).toBe(0);
  });

  it('does not accumulate unbounded entries after many distinct repo paths are used', async () => {
    const paths = Array.from({ length: 200 }, (_, i) => `/repo/leak-many/${i}`);
    await Promise.all(paths.map((p) => withWorktreeLock(p, async () => undefined)));
    await flushMicrotasks();

    expect(_getWorktreeLockMapSizeForTests()).toBe(0);
  });

  it('keeps serializing a call queued in the exact race window between a settling chain and its (guarded) cleanup', async () => {
    // This reproduces the race the identity check in withWorktreeLock guards
    // against: call2 and call3 are queued synchronously inside a `.then`
    // reaction on call1's own promise, which lands them in the same
    // microtask window the lock's internal cleanup uses to decide whether
    // to delete its map entry. If cleanup deleted unconditionally, call3
    // would see no entry for the key and run concurrently with call2
    // instead of waiting for it.
    const order: string[] = [];
    const call2Gate = deferred<void>();
    let call2: Promise<void>;
    let call3: Promise<void>;

    const call1 = withWorktreeLock('/repo/race', async () => {
      order.push('1');
    });

    const raceSetup = call1.then(() => {
      call2 = withWorktreeLock('/repo/race', async () => {
        order.push('2-start');
        await call2Gate.promise;
        order.push('2-end');
      });
      call3 = withWorktreeLock('/repo/race', async () => {
        order.push('3');
      });
    });

    await raceSetup;
    await Promise.resolve();
    await Promise.resolve();

    // call3 must still be queued behind the still-running call2.
    expect(order).toEqual(['1', '2-start']);

    call2Gate.resolve();
    await Promise.all([call2!, call3!]);

    expect(order).toEqual(['1', '2-start', '2-end', '3']);

    await flushMicrotasks();
    expect(_getWorktreeLockMapSizeForTests()).toBe(0);
  });
});
