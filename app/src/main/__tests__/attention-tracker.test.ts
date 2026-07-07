import { describe, it, expect, vi } from 'vitest';
import { AttentionTracker } from '../attention-tracker.js';

describe('AttentionTracker', () => {
  it('starts a session in the requested state and notifies change listeners', () => {
    const tracker = new AttentionTracker();
    const changes: string[] = [];
    tracker.onChange(entry => changes.push(entry.state));

    tracker.setWorking('s1', 'chat', '/wt/a');
    expect(tracker.get('s1')).toMatchObject({ sessionId: 's1', kind: 'chat', worktreePath: '/wt/a', state: 'working', heuristic: false });
    expect(changes).toEqual(['working']);
  });

  it('transitions through the full chat lifecycle: awaiting-input -> working -> awaiting-permission -> working -> awaiting-input', () => {
    const tracker = new AttentionTracker();

    tracker.setAwaitingInput('s1', 'chat', '/wt/a');
    expect(tracker.get('s1')?.state).toBe('awaiting-input');

    tracker.setWorking('s1', 'chat', '/wt/a');
    expect(tracker.get('s1')?.state).toBe('working');

    tracker.setAwaitingPermission('s1', 'chat', '/wt/a');
    expect(tracker.get('s1')?.state).toBe('awaiting-permission');
    expect(tracker.get('s1')?.heuristic).toBe(false);

    tracker.setWorking('s1', 'chat', '/wt/a');
    expect(tracker.get('s1')?.state).toBe('working');

    tracker.setAwaitingInput('s1', 'chat', '/wt/a');
    expect(tracker.get('s1')?.state).toBe('awaiting-input');
  });

  it('marks finished/failed sessions distinctly and fires remove listeners on remove()', () => {
    const tracker = new AttentionTracker();
    const removed: string[] = [];
    tracker.onRemove(id => removed.push(id));

    tracker.setWorking('s1', 'terminal', '/wt/a');
    tracker.setFinished('s1', 'terminal', '/wt/a');
    expect(tracker.get('s1')?.state).toBe('finished');

    tracker.remove('s1');
    expect(tracker.get('s1')).toBeUndefined();
    expect(removed).toEqual(['s1']);

    tracker.setWorking('s2', 'terminal', '/wt/b');
    tracker.setFailed('s2', 'terminal', '/wt/b');
    expect(tracker.get('s2')?.state).toBe('failed');
  });

  it('scheduleRemoval() keeps the entry visible until the delay elapses, then removes it', () => {
    vi.useFakeTimers();
    try {
      const tracker = new AttentionTracker();
      const removed: string[] = [];
      tracker.onRemove(id => removed.push(id));

      tracker.setFinished('s1', 'terminal', '/wt/a');
      tracker.scheduleRemoval('s1', 5000);
      expect(tracker.get('s1')?.state).toBe('finished');
      expect(removed).toEqual([]);

      vi.advanceTimersByTime(4999);
      expect(tracker.get('s1')).toBeDefined();

      vi.advanceTimersByTime(2);
      expect(tracker.get('s1')).toBeUndefined();
      expect(removed).toEqual(['s1']);
    } finally {
      vi.useRealTimers();
    }
  });

  it('an explicit remove() before the scheduled delay cancels the pending timer', () => {
    vi.useFakeTimers();
    try {
      const tracker = new AttentionTracker();
      const removed: string[] = [];
      tracker.onRemove(id => removed.push(id));

      tracker.setFinished('s1', 'terminal', '/wt/a');
      tracker.scheduleRemoval('s1', 5000);
      tracker.remove('s1');
      expect(removed).toEqual(['s1']);

      vi.advanceTimersByTime(10000);
      // The scheduled timer must not fire a second (spurious) removal.
      expect(removed).toEqual(['s1']);
    } finally {
      vi.useRealTimers();
    }
  });

  it('remove() is a no-op (does not notify) for an unknown session id', () => {
    const tracker = new AttentionTracker();
    const removed: string[] = [];
    tracker.onRemove(id => removed.push(id));
    tracker.remove('does-not-exist');
    expect(removed).toEqual([]);
  });

  it('list() reflects every currently-tracked session', () => {
    const tracker = new AttentionTracker();
    tracker.setWorking('s1', 'chat', '/wt/a');
    tracker.setAwaitingPermission('s2', 'terminal', '/wt/b');
    expect(tracker.list().map(e => e.sessionId).sort()).toEqual(['s1', 's2']);
  });

  it('setIdle() sets awaiting-input state with heuristic: true, distinguishing it from an explicit awaiting-input signal', () => {
    const tracker = new AttentionTracker();
    tracker.setIdle('s1', 'terminal', '/wt/a');
    expect(tracker.get('s1')).toMatchObject({ state: 'awaiting-input', heuristic: true });

    tracker.setAwaitingInput('s2', 'chat', '/wt/b');
    expect(tracker.get('s2')).toMatchObject({ state: 'awaiting-input', heuristic: false });
  });

  it('unsubscribing a listener stops further notifications', () => {
    const tracker = new AttentionTracker();
    const changes: string[] = [];
    const off = tracker.onChange(entry => changes.push(entry.state));
    tracker.setWorking('s1', 'chat', '/wt/a');
    off();
    tracker.setAwaitingInput('s1', 'chat', '/wt/a');
    expect(changes).toEqual(['working']);
  });
});
