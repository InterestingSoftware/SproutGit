import { describe, it, expect } from 'vitest';
import { IdleTracker } from '../idle-tracker.js';

describe('IdleTracker', () => {
  it('does not report a session before it crosses the threshold', () => {
    const tracker = new IdleTracker();
    tracker.touch('a', 1000);
    expect(tracker.checkIdle(500, 1499)).toEqual([]);
  });

  it('reports a session once it crosses the threshold', () => {
    const tracker = new IdleTracker();
    tracker.touch('a', 1000);
    expect(tracker.checkIdle(500, 1500)).toEqual(['a']);
  });

  it('does not report the same idle period twice', () => {
    const tracker = new IdleTracker();
    tracker.touch('a', 1000);
    expect(tracker.checkIdle(500, 1500)).toEqual(['a']);
    expect(tracker.checkIdle(500, 2000)).toEqual([]);
  });

  it('re-arms after new activity, allowing a later idle period to report again', () => {
    const tracker = new IdleTracker();
    tracker.touch('a', 1000);
    expect(tracker.checkIdle(500, 1500)).toEqual(['a']);
    tracker.touch('a', 1600);
    expect(tracker.checkIdle(500, 1900)).toEqual([]);
    expect(tracker.checkIdle(500, 2100)).toEqual(['a']);
  });

  it('stops tracking a session once removed', () => {
    const tracker = new IdleTracker();
    tracker.touch('a', 1000);
    tracker.remove('a');
    expect(tracker.checkIdle(500, 2000)).toEqual([]);
  });

  it('tracks multiple sessions independently', () => {
    const tracker = new IdleTracker();
    tracker.touch('a', 1000);
    tracker.touch('b', 1400);
    expect(tracker.checkIdle(500, 1500)).toEqual(['a']);
    expect(tracker.checkIdle(500, 1900)).toEqual(['b']);
  });
});
