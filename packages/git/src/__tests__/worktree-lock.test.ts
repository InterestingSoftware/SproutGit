import { describe, it, expect } from 'vitest';
import { withWorktreeLock } from '../worktree-lock.js';

function deferred<T>(): { promise: Promise<T>; resolve: (v: T) => void; reject: (e: unknown) => void } {
  let resolve!: (v: T) => void;
  let reject!: (e: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
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
});
