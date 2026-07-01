import { describe, it, expect } from 'vitest';
import { computeGraphLayout } from '../components/CommitGraph.js';
import { type CommitEntry } from '@sproutgit/types';

// Minimal commit factory — only hash/parents/refs matter to the layout.
function commit(hash: string, parents: string[], refs: string[] = []): CommitEntry {
  return {
    hash,
    shortHash: hash.slice(0, 7),
    parents,
    authorName: 'Test',
    authorEmail: 'test@example.com',
    authorDate: '2026-01-01T00:00:00Z',
    subject: `commit ${hash}`,
    refs,
  };
}

function layout(commits: CommitEntry[]) {
  return computeGraphLayout(commits, new Set());
}

describe('computeGraphLayout', () => {
  it('keeps a linear history in a single lane with straight segments', () => {
    const { rows, gapSegments, maxLane } = layout([
      commit('c', ['b']),
      commit('b', ['a']),
      commit('a', []),
    ]);
    expect(maxLane).toBe(0);
    expect(rows.map(r => r.lane)).toEqual([0, 0, 0]);
    for (const segs of gapSegments) {
      expect(segs).toEqual([{ fromLane: 0, toLane: 0, railLane: 0 }]);
    }
  });

  it('places a merge second parent on its own rail until the branch tip', () => {
    // m merges feature f (branched from a) into main: m → [b, f], b → a, f → a
    const { rows, gapSegments } = layout([
      commit('m', ['b', 'f']),
      commit('b', ['a']),
      commit('f', ['a']),
      commit('a', []),
    ]);
    const byHash = Object.fromEntries(rows.map(r => [r.hash, r]));
    expect(byHash['m']!.lane).toBe(0);
    expect(byHash['b']!.lane).toBe(0);
    expect(byHash['f']!.lane).toBe(1); // branch commit sits on the rail lane
    expect(byHash['a']!.lane).toBe(0);
    // Gap 0 (m→b band): main straight + merge edge branching out to lane 1.
    expect(gapSegments[0]).toContainEqual({ fromLane: 0, toLane: 0, railLane: 0 });
    expect(gapSegments[0]).toContainEqual({ fromLane: 0, toLane: 1, railLane: 1 });
    // Gap 1: rail runs straight down lane 1 to f.
    expect(gapSegments[1]).toContainEqual({ fromLane: 1, toLane: 1, railLane: 1 });
    // Gap 2 (f→a band): f joins the lane-0 rail heading to a.
    expect(gapSegments[2]).toContainEqual({ fromLane: 1, toLane: 0, railLane: 0 });
  });

  it('never emits a segment spanning more than one row band', () => {
    // Interleaved branches to force long-lived rails.
    const commits = [
      commit('m2', ['m1', 'f2']),
      commit('x', ['m1']),
      commit('f2', ['f1']),
      commit('m1', ['b', 'f1']),
      commit('b', ['a']),
      commit('f1', ['a']),
      commit('a', []),
    ];
    const { rows, gapSegments } = layout(commits);
    // Every segment lives in exactly one gap by construction; verify each
    // cross-lane transition starts or ends on the rail lane it belongs to.
    gapSegments.forEach(segs => {
      for (const seg of segs) {
        expect([seg.fromLane, seg.toLane]).toContain(seg.railLane);
      }
    });
    // Two rails must never occupy the same lane in the same gap heading to
    // different places: (gap, railLane, toLane) pairs are unique per fromLane.
    gapSegments.forEach(segs => {
      const keys = segs.map(s => `${s.fromLane}:${s.toLane}`);
      expect(new Set(keys).size).toBe(keys.length);
    });
    // Children sharing a parent converge on one rail: at most one straight
    // segment per lane per gap.
    gapSegments.forEach(segs => {
      const straights = segs.filter(s => s.fromLane === s.toLane).map(s => s.fromLane);
      expect(new Set(straights).size).toBe(straights.length);
    });
    expect(rows).toHaveLength(commits.length);
  });

  it('reuses a lane after its branch closes', () => {
    // Two sequential feature branches — the second should reuse lane 1.
    const { rows } = layout([
      commit('m2', ['m1', 'g']),
      commit('g', ['m1']),
      commit('m1', ['b', 'f']),
      commit('f', ['b']),
      commit('b', []),
    ]);
    const byHash = Object.fromEntries(rows.map(r => [r.hash, r]));
    expect(byHash['g']!.lane).toBe(1);
    expect(byHash['f']!.lane).toBe(1);
  });

  it('a commit whose parent is outside the loaded window emits no segments', () => {
    const { rows, gapSegments } = layout([
      commit('b', ['missing']),
      commit('a', ['also-missing']),
    ]);
    expect(rows.map(r => r.lane)).toEqual([0, 0]);
    expect(gapSegments[0]).toEqual([]);
  });

  it('handles an empty commit list', () => {
    expect(layout([])).toEqual({ rows: [], gapSegments: [], maxLane: 0 });
  });
});
