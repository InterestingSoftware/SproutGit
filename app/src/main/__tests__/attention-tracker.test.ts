import { describe, it, expect, vi } from 'vitest';
import { AttentionTracker, PtyIdleHeuristic, PTY_IDLE_THRESHOLD_MS, FINISHED_ENTRY_TTL_MS } from '../attention-tracker.js';

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

describe('PtyIdleHeuristic', () => {
  function setup(startTime = 0) {
    let now = startTime;
    const tracker = new AttentionTracker();
    const heuristic = new PtyIdleHeuristic(tracker, () => now);
    return { tracker, heuristic, advance: (ms: number) => { now += ms; } };
  }

  it('starts a watched session as working', () => {
    const { tracker, heuristic } = setup();
    heuristic.start('t1', '/wt/a');
    expect(tracker.get('t1')).toMatchObject({ kind: 'terminal', state: 'working', heuristic: false });
  });

  it('flags a silent session as idle once past the threshold, without touching unwatched sessions', () => {
    const { tracker, heuristic, advance } = setup();
    heuristic.start('t1', '/wt/a');
    tracker.setWorking('other', 'chat', '/wt/b'); // not watched by the heuristic

    advance(PTY_IDLE_THRESHOLD_MS - 1);
    heuristic.sweep();
    expect(tracker.get('t1')?.state).toBe('working');

    advance(2);
    heuristic.sweep();
    expect(tracker.get('t1')).toMatchObject({ state: 'awaiting-input', heuristic: true });
    // Unrelated session untouched by the sweep.
    expect(tracker.get('other')?.state).toBe('working');
  });

  it('resets an idle session back to working as soon as output resumes', () => {
    const { tracker, heuristic, advance } = setup();
    heuristic.start('t1', '/wt/a');
    advance(PTY_IDLE_THRESHOLD_MS + 1);
    heuristic.sweep();
    expect(tracker.get('t1')?.heuristic).toBe(true);

    heuristic.noteOutput('t1');
    expect(tracker.get('t1')).toMatchObject({ state: 'working', heuristic: false });
  });

  it('noteOutput() on a non-idle session does not spuriously re-emit a change', () => {
    const { tracker, heuristic } = setup();
    heuristic.start('t1', '/wt/a');
    const changes: string[] = [];
    tracker.onChange(entry => changes.push(entry.state));
    heuristic.noteOutput('t1');
    expect(changes).toEqual([]);
  });

  it('finish() marks the session finished/failed by exit success, keeping it visible briefly before pruning it', () => {
    vi.useFakeTimers();
    try {
      const { tracker, heuristic } = setup();
      heuristic.start('t1', '/wt/a');
      heuristic.finish('t1', true);
      // The entry stays visible right after finish() — so a live UI (or a
      // session:attentionList snapshot taken in this window) can actually
      // render the "Finished" chip instead of the row vanishing before it's
      // ever seen, since the owning terminal session's own metadata is
      // deleted immediately on exit.
      expect(tracker.get('t1')?.state).toBe('finished');

      vi.advanceTimersByTime(FINISHED_ENTRY_TTL_MS + 1);
      expect(tracker.get('t1')).toBeUndefined();

      heuristic.start('t2', '/wt/b');
      heuristic.finish('t2', false);
      expect(tracker.get('t2')?.state).toBe('failed');
      vi.advanceTimersByTime(FINISHED_ENTRY_TTL_MS + 1);
      expect(tracker.get('t2')).toBeUndefined();
    } finally {
      vi.useRealTimers();
    }
  });

  it('sweep()/noteOutput()/finish() are no-ops for a session id that was never start()ed', () => {
    const { tracker, heuristic } = setup();
    expect(() => heuristic.noteOutput('unknown')).not.toThrow();
    expect(() => heuristic.finish('unknown', true)).not.toThrow();
    expect(() => heuristic.sweep()).not.toThrow();
    expect(tracker.list()).toEqual([]);
  });

  it('does not flag a session idle a second time (heuristic already applied) on repeated sweeps', () => {
    const { tracker, heuristic, advance } = setup();
    heuristic.start('t1', '/wt/a');
    advance(PTY_IDLE_THRESHOLD_MS + 1);
    heuristic.sweep();
    const firstUpdatedAt = tracker.get('t1')?.updatedAt;
    advance(1000);
    heuristic.sweep();
    expect(tracker.get('t1')?.updatedAt).toBe(firstUpdatedAt);
  });
});
