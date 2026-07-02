import { useState, useRef, useEffect, useMemo } from 'react';
import { Search, ChevronUp, ChevronDown, X, GitBranch, TreePine, Tag } from 'lucide-react';
import { type CommitEntry, type WorktreeInfo, type IssueTrackerPattern } from '@sproutgit/types';
import { linkifyIssueRefs } from '../issuetracker-linkify.js';

// ─── Constants ────────────────────────────────────────────────────────────────

const ROW_H = 28;
const COL_W = 16;
const NODE_R = 4;
const PADDING_LEFT = 8;

const LANE_COLORS = [
  'var(--sg-primary)',
  'var(--sg-accent)',
  '#e879a0',
  '#fab387',
  '#a6e3a1',
  '#cba6f7',
  '#f9e2af',
  '#89dceb',
  '#f5c2e7',
  '#94e2d5',
];

// ─── Lane algorithm ───────────────────────────────────────────────────────────

type LaneCommit = CommitEntry & {
  lane: number;
  y: number;
  worktreeBranch: string | null;
};

/** One edge piece confined to the gap between two adjacent rows. */
export type GapSegment = {
  fromLane: number;
  toLane: number;
  /** Lane whose colour the segment takes (the rail the edge travels on). */
  railLane: number;
};

export type GraphLayout = {
  rows: LaneCommit[];
  /** gapSegments[g] = segments in the band between row g and row g+1. */
  gapSegments: GapSegment[][];
  maxLane: number;
};

/**
 * Per-row segment layout. Every child→parent edge travels on its own "rail":
 * it bends from the child's lane into the rail within the child's row band,
 * runs straight down the rail, and bends into the parent's lane in the final
 * band. The parent adopts the leftmost incoming rail, so a long-lived branch
 * (main) keeps one lane instead of drifting toward whichever child happened
 * to reach the fork point first. Lane transitions never span more than one
 * row band.
 */
export function computeGraphLayout(
  commits: CommitEntry[],
  worktreeBranches: Set<string>
): GraphLayout {
  if (commits.length === 0) return { rows: [], gapSegments: [], maxLane: 0 };

  const hashToIdx = new Map<string, number>();
  commits.forEach((c, i) => hashToIdx.set(c.hash, i));

  // Incoming lines in flight, indexed by target parent hash. A parent forked
  // into several children carries one entry per child edge. Adjacent-row
  // edges register their child's lane as a candidate without occupying it.
  type Incoming = { lane: number; firstParent: boolean; occupies: boolean };
  const railsByParent = new Map<string, Incoming[]>();
  const laneOccupied: boolean[] = [];

  function allocLane(minLane: number): number {
    for (let l = minLane; l < laneOccupied.length; l++) {
      if (!laneOccupied[l]) return l;
    }
    return Math.max(laneOccupied.length, minLane);
  }

  function registerIncoming(parentHash: string, entry: Incoming): void {
    const list = railsByParent.get(parentHash);
    if (list) list.push(entry);
    else railsByParent.set(parentHash, [entry]);
  }

  type Edge = {
    childRow: number;
    childLane: number;
    /** Transit lane; null for adjacent-row edges that bend directly. */
    rail: number | null;
    parentHash: string;
  };
  const edges: Edge[] = [];
  const rows: LaneCommit[] = [];
  let maxLane = 0;

  for (let i = 0; i < commits.length; i++) {
    const commit = commits[i]!;

    // Adopt a lane from the incoming lines: first-parent edges take priority
    // (so a long-lived branch keeps one lane through merges and forks), then
    // leftmost wins. Non-occupying candidates are only valid if their lane
    // isn't taken by a passing rail. Tips open a fresh lane.
    const incoming = railsByParent.get(commit.hash) ?? [];
    railsByParent.delete(commit.hash);
    const candidates = incoming.filter(c => c.occupies || !laneOccupied[c.lane]);
    let lane: number;
    if (candidates.length > 0) {
      let best = candidates[0]!;
      for (const c of candidates) {
        if (
          (c.firstParent && !best.firstParent) ||
          (c.firstParent === best.firstParent && c.lane < best.lane)
        ) {
          best = c;
        }
      }
      lane = best.lane;
    } else {
      lane = allocLane(0);
    }
    for (const c of incoming) {
      if (c.occupies) laneOccupied[c.lane] = false;
    }
    if (lane > maxLane) maxLane = lane;

    for (let p = 0; p < commit.parents.length; p++) {
      const parentHash = commit.parents[p]!;
      const parentRow = hashToIdx.get(parentHash);
      if (parentRow === undefined) continue; // parent beyond the loaded window
      if (parentRow === i + 1) {
        // Adjacent rows — the edge is a single bend, no transit lane needed.
        edges.push({ childRow: i, childLane: lane, rail: null, parentHash });
        registerIncoming(parentHash, { lane, firstParent: p === 0, occupies: false });
        continue;
      }
      // First parent continues in the commit's own lane; other parents branch
      // out to the nearest free lane on the right.
      const railLane =
        p === 0 && !laneOccupied[lane] ? lane : allocLane(lane + 1);
      laneOccupied[railLane] = true;
      registerIncoming(parentHash, { lane: railLane, firstParent: p === 0, occupies: true });
      if (railLane > maxLane) maxLane = railLane;
      edges.push({ childRow: i, childLane: lane, rail: railLane, parentHash });
    }

    const wtBranch = commit.refs.find(r => worktreeBranches.has(r)) ?? null;
    rows.push({ ...commit, lane, y: i * ROW_H + ROW_H / 2, worktreeBranch: wtBranch });
  }

  // Rasterise edges into per-gap segments, deduping identical pieces.
  const gapCount = commits.length - 1;
  const gapSegments: GapSegment[][] = Array.from({ length: gapCount }, () => []);
  const seen = new Set<string>();

  for (const edge of edges) {
    const parentRow = hashToIdx.get(edge.parentHash)!;
    const parentLane = rows[parentRow]!.lane;
    const rail = edge.rail ?? parentLane;
    for (let g = edge.childRow; g < parentRow && g < gapCount; g++) {
      const fromLane = g === edge.childRow ? edge.childLane : rail;
      const toLane = g === parentRow - 1 ? parentLane : rail;
      const key = `${g}:${fromLane}:${toLane}`;
      if (seen.has(key)) continue;
      seen.add(key);
      gapSegments[g]!.push({ fromLane, toLane, railLane: rail });
    }
  }

  return { rows, gapSegments, maxLane };
}

function laneX(lane: number): number {
  return PADDING_LEFT + lane * COL_W + COL_W / 2;
}

function laneColor(lane: number): string {
  return LANE_COLORS[lane % LANE_COLORS.length]!;
}

// ─── Props ────────────────────────────────────────────────────────────────────

type ContextMenuItem =
  | { label: string; action: () => void; danger?: boolean }
  | { separator: true };

type Props = {
  commits: CommitEntry[];
  worktrees?: WorktreeInfo[];
  activeWorktree?: WorktreeInfo | null;
  onCreateWorktree?: (fromRef: string) => void;
  onCheckout?: (targetRef: string) => void;
  onReset?: (targetRef: string, mode: 'soft' | 'mixed' | 'hard') => void;
  onSelect?: (commits: CommitEntry[]) => void;
  hasMore?: boolean;
  loadingMore?: boolean;
  onLoadMore?: () => void;
  issueTrackerPatterns?: IssueTrackerPattern[];
};

// ─── Component ────────────────────────────────────────────────────────────────

/**
 * SVG lane-based commit graph. Preserves the layout, colors, and interaction
 * model from the old Svelte version.
 */
export function CommitGraph({
  commits,
  worktrees = [],
  activeWorktree = null,
  onCreateWorktree,
  onCheckout,
  onReset,
  onSelect,
  hasMore = false,
  loadingMore = false,
  onLoadMore,
  issueTrackerPatterns = [],
}: Props) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const [scrollTop, setScrollTop] = useState(0);
  const [containerHeight, setContainerHeight] = useState(0);

  const [searchOpen, setSearchOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [activeMatchIdx, setActiveMatchIdx] = useState(0);
  const searchInputRef = useRef<HTMLInputElement>(null);

  const [selectedIndices, setSelectedIndices] = useState<Set<number>>(new Set());
  const [lastClickedIdx, setLastClickedIdx] = useState<number | null>(null);

  const [contextMenu, setContextMenu] = useState<{
    x: number; y: number; items: ContextMenuItem[];
  } | null>(null);

  // Derived sets.
  const worktreeBranches = useMemo(
    () => new Set(worktrees.filter(w => w.branch).map(w => w.branch!)),
    [worktrees]
  );

  const { rows, gapSegments, maxLane } = useMemo(
    () => computeGraphLayout(commits, worktreeBranches),
    [commits, worktreeBranches]
  );

  const svgWidth = (maxLane + 1) * COL_W + PADDING_LEFT * 2;
  const svgHeight = commits.length * ROW_H;

  // Search matches.
  const matchingIndices = (() => {
    if (!searchQuery.trim()) return [] as number[];
    const q = searchQuery.toLowerCase();
    const indices: number[] = [];
    rows.forEach((row, i) => {
      if (
        row.subject.toLowerCase().includes(q) ||
        row.shortHash.toLowerCase().includes(q) ||
        row.hash.toLowerCase().includes(q)
      ) indices.push(i);
    });
    return indices;
  })();

  const matchSet = new Set(matchingIndices);

  // Container resize observer.
  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    setContainerHeight(el.clientHeight);
    const ro = new ResizeObserver(() => setContainerHeight(el.clientHeight));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  // Global Cmd/Ctrl+F to open search.
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === 'f') {
        e.preventDefault();
        setSearchOpen(true);
        setActiveMatchIdx(0);
        requestAnimationFrame(() => searchInputRef.current?.focus());
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, []);

  // Scroll to match when query changes.
  useEffect(() => {
    if (matchingIndices.length > 0) {
      setActiveMatchIdx(0);
      scrollToMatchIndex(0);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [matchingIndices]);

  function scrollToMatchIndex(mIdx: number) {
    const rowIdx = matchingIndices[mIdx];
    if (rowIdx == null || !scrollRef.current) return;
    const targetY = rowIdx * ROW_H - scrollRef.current.clientHeight / 2 + ROW_H / 2;
    scrollRef.current.scrollTo({ top: Math.max(0, targetY), behavior: 'smooth' });
  }

  const nextMatch = () => {
    if (matchingIndices.length === 0) return;
    const next = (activeMatchIdx + 1) % matchingIndices.length;
    setActiveMatchIdx(next);
    scrollToMatchIndex(next);
  };

  const prevMatch = () => {
    if (matchingIndices.length === 0) return;
    const prev = (activeMatchIdx - 1 + matchingIndices.length) % matchingIndices.length;
    setActiveMatchIdx(prev);
    scrollToMatchIndex(prev);
  };

  // Selection.
  function handleCommitClick(idx: number, e: React.MouseEvent) {
    setSelectedIndices(prev => {
      if (e.shiftKey && lastClickedIdx !== null) {
        const start = Math.min(lastClickedIdx, idx);
        const end = Math.max(lastClickedIdx, idx);
        const next = new Set<number>();
        for (let i = start; i <= end; i++) next.add(i);
        return next;
      } else if (e.metaKey || e.ctrlKey) {
        const next = new Set(prev);
        if (next.has(idx)) next.delete(idx);
        else next.add(idx);
        return next;
      } else {
        if (prev.size === 1 && prev.has(idx)) return new Set();
        return new Set([idx]);
      }
    });
    if (!e.shiftKey) setLastClickedIdx(idx);
  }

  useEffect(() => {
    if (onSelect) {
      const selected = [...selectedIndices]
        .sort((a, b) => a - b)
        .map(i => rows[i])
        .filter((r): r is LaneCommit => r !== undefined);
      onSelect(selected);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedIndices]);

  // Scroll + infinite load.
  function handleScroll() {
    const el = scrollRef.current;
    if (!el) return;
    setScrollTop(el.scrollTop);
    if (hasMore && !loadingMore && onLoadMore) {
      const remaining = el.scrollHeight - (el.scrollTop + el.clientHeight);
      if (remaining <= ROW_H * 12) onLoadMore();
    }
  }

  // Context menu.
  function copyToClipboard(text: string) {
    void navigator.clipboard.writeText(text);
  }

  function buildContextMenuItems(row: LaneCommit): ContextMenuItem[] {
    const items: ContextMenuItem[] = [
      { label: 'Copy full hash', action: () => copyToClipboard(row.hash) },
      { label: 'Copy short hash', action: () => copyToClipboard(row.shortHash) },
      { label: 'Copy commit message', action: () => copyToClipboard(row.subject) },
      { separator: true },
    ];
    if (onCreateWorktree) {
      items.push({ label: 'Create worktree from here', action: () => onCreateWorktree(row.hash) });
    }
    if (onCheckout) {
      items.push({ label: 'Checkout this commit', action: () => onCheckout(row.hash) });
    }
    if (onReset) {
      items.push({ separator: true });
      items.push({ label: 'Reset (soft) to here', action: () => onReset(row.hash, 'soft') });
      items.push({ label: 'Reset (mixed) to here', action: () => onReset(row.hash, 'mixed') });
      items.push({ label: 'Reset (hard) to here — destructive', action: () => onReset(row.hash, 'hard'), danger: true });
    }
    return items;
  }

  function handleContextMenu(row: LaneCommit, e: React.MouseEvent) {
    e.preventDefault();
    setContextMenu({ x: e.clientX, y: e.clientY, items: buildContextMenuItems(row) });
  }

  // ─── Render ────────────────────────────────────────────────────────────────

  if (rows.length === 0) {
    return (
      <div className="commit-graph-empty">
        <span>No commits</span>
      </div>
    );
  }

  // Virtualise: only render rows within ±200px of the visible viewport.
  const firstVisible = Math.max(0, Math.floor((scrollTop - 200) / ROW_H));
  const lastVisible = Math.min(rows.length - 1, Math.ceil((scrollTop + containerHeight + 200) / ROW_H));

  return (
    <div style={{ position: 'relative', height: '100%', display: 'flex', flexDirection: 'column' }}>
      {/* Search bar */}
      {searchOpen && (
        <div className="commit-graph-search">
          <Search size={12} />
          <input
            ref={searchInputRef}
            value={searchQuery}
            onChange={e => setSearchQuery(e.target.value)}
            onKeyDown={e => {
              if (e.key === 'Escape') { setSearchOpen(false); setSearchQuery(''); }
              else if (e.key === 'Enter') { if (e.shiftKey) { prevMatch(); } else { nextMatch(); } }
            }}
            placeholder="Search commits…"
          />
          {matchingIndices.length > 0 && (
            <span className="commit-graph-search-count">
              {activeMatchIdx + 1}/{matchingIndices.length}
            </span>
          )}
          <button onClick={prevMatch} title="Previous match"><ChevronUp size={12} /></button>
          <button onClick={nextMatch} title="Next match"><ChevronDown size={12} /></button>
          <button onClick={() => { setSearchOpen(false); setSearchQuery(''); }}><X size={12} /></button>
        </div>
      )}

      <div
        ref={scrollRef}
        onScroll={handleScroll}
        style={{ flex: 1, overflowY: 'auto', overflowX: 'hidden', position: 'relative' }}
      >
        {/* Sticky SVG lane column */}
        <div style={{ position: 'sticky', left: 0, width: svgWidth, float: 'left', height: svgHeight, zIndex: 1 }}>
          <svg width={svgWidth} height={svgHeight} style={{ display: 'block' }}>
            {/* Edge segments (drawn first so nodes always sit on top) */}
            <g>
              {gapSegments.map((segs, g) => {
                // Gap g spans rows g..g+1 — render if either endpoint row is visible.
                if (g < firstVisible - 1 || g > lastVisible) return null;
                const y1 = g * ROW_H + ROW_H / 2;
                const y2 = y1 + ROW_H;
                const midY = y1 + ROW_H / 2;
                return (
                  <g key={g}>
                    {segs.map(seg => {
                      const x1 = laneX(seg.fromLane);
                      const x2 = laneX(seg.toLane);
                      const d = x1 === x2
                        ? `M ${x1} ${y1} L ${x2} ${y2}`
                        : `M ${x1} ${y1} C ${x1} ${midY} ${x2} ${midY} ${x2} ${y2}`;
                      return (
                        <path
                          key={`${seg.fromLane}-${seg.toLane}`}
                          d={d}
                          stroke={laneColor(seg.railLane)}
                          strokeWidth={1.5}
                          fill="none"
                          opacity={0.8}
                        />
                      );
                    })}
                  </g>
                );
              })}
            </g>
            {/* Commit nodes */}
            <g>
              {rows.map((row, i) => {
                if (i < firstVisible || i > lastVisible) return null;
                const cx = laneX(row.lane);
                const color = laneColor(row.lane);
                return row.worktreeBranch ? (
                  // Diamond for worktree commits.
                  <polygon
                    key={row.hash}
                    points={`${cx},${row.y - NODE_R - 2} ${cx + NODE_R + 2},${row.y} ${cx},${row.y + NODE_R + 2} ${cx - NODE_R - 2},${row.y}`}
                    fill={color}
                  />
                ) : (
                  <circle key={row.hash} cx={cx} cy={row.y} r={NODE_R} fill={color} />
                );
              })}
            </g>
          </svg>
        </div>

        {/* Commit rows */}
        <div style={{ marginLeft: svgWidth, minHeight: svgHeight }}>
          {rows.map((row, i) => {
            if (i < firstVisible || i > lastVisible) {
              return <div key={row.hash} style={{ height: ROW_H }} />;
            }
            const isSelected = selectedIndices.has(i);
            const isMatch = matchSet.has(i);
            const isActiveMatch = matchingIndices[activeMatchIdx] === i;

            return (
              <div
                key={row.hash}
                role="row"
                aria-selected={isSelected}
                tabIndex={0}
                onClick={e => handleCommitClick(i, e)}
                onKeyDown={e => { if (e.key === 'Enter' || e.key === ' ') handleCommitClick(i, e as unknown as React.MouseEvent); }}
                onContextMenu={e => handleContextMenu(row, e)}
                data-testid={`commit-row-${row.shortHash}`}
                className={[
                  'commit-row',
                  isSelected ? 'commit-row--selected' : '',
                  isMatch ? 'commit-row--match' : '',
                  isActiveMatch ? 'commit-row--active-match' : '',
                ].filter(Boolean).join(' ')}
                style={{ height: ROW_H }}
              >
                {/* Refs (branch/tag badges) */}
                <div className="commit-row-refs">
                  {row.refs.map(ref => {
                    if (ref === 'HEAD') return null;
                    const isTag = ref.startsWith('tag: ');
                    const isWt = worktreeBranches.has(ref);
                    const label = isTag ? ref.replace('tag: ', '') : ref;
                    return (
                      <span
                        key={ref}
                        className={['commit-ref', isTag ? 'commit-ref--tag' : '', isWt ? 'commit-ref--worktree' : ''].filter(Boolean).join(' ')}
                        title={label}
                        onClick={e => { e.stopPropagation(); void navigator.clipboard.writeText(label); }}
                      >
                        {isTag ? <Tag size={10} /> : isWt ? <TreePine size={10} /> : <GitBranch size={10} />}
                        {label}
                      </span>
                    );
                  })}
                </div>
                {/* Commit subject */}
                <span
                  className="commit-row-subject"
                  title={row.subject}
                  onClick={e => {
                    if (e.target instanceof HTMLAnchorElement) {
                      e.preventDefault();
                      e.stopPropagation();
                      window.api.openUrl(e.target.href).catch(() => undefined);
                    }
                  }}
                  dangerouslySetInnerHTML={{ __html: linkifyIssueRefs(row.subject, issueTrackerPatterns) }}
                />
                {/* Meta columns */}
                <span className="commit-row-hash" title={row.hash}>{row.shortHash}</span>
                <span className="commit-row-author" title={row.authorName}>{row.authorName}</span>
                <span className="commit-row-date" title={formatFullDate(row.authorDate)}>{formatRelativeDate(row.authorDate)}</span>
              </div>
            );
          })}

          {/* Load more sentinel */}
          {hasMore && (
            <div className="commit-graph-load-more">
              {loadingMore ? <span>Loading…</span> : <button onClick={onLoadMore}>Load more</button>}
            </div>
          )}
        </div>
      </div>

      {/* Context menu */}
      {contextMenu && (
        <>
          <div
            style={{ position: 'fixed', inset: 0, zIndex: 99 }}
            onClick={() => setContextMenu(null)}
            onContextMenu={e => { e.preventDefault(); setContextMenu(null); }}
          />
          <div
            className="context-menu"
            style={{ position: 'fixed', left: contextMenu.x, top: contextMenu.y, zIndex: 100 }}
          >
            {contextMenu.items.map((item, i) =>
              'separator' in item ? (
                <div key={i} className="context-menu-separator" />
              ) : (
                <button
                  key={i}
                  className={['context-menu-item', item.danger ? 'context-menu-item--danger' : ''].filter(Boolean).join(' ')}
                  onClick={() => { item.action(); setContextMenu(null); }}
                >
                  {item.label}
                </button>
              )
            )}
          </div>
        </>
      )}
    </div>
  );
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function formatRelativeDate(iso: string): string {
  try {
    const date = new Date(iso);
    const diff = Date.now() - date.getTime();
    const mins = Math.floor(diff / 60_000);
    const hours = Math.floor(diff / 3_600_000);
    const days = Math.floor(diff / 86_400_000);
    if (mins < 1)   return 'just now';
    if (mins < 60)  return `${mins}m ago`;
    if (hours < 24) return `${hours}h ago`;
    if (days === 1) return 'yesterday';
    if (days < 30)  return `${days}d ago`;
    if (days < 365) return `${Math.floor(days / 30)}mo ago`;
    return `${Math.floor(days / 365)}y ago`;
  } catch {
    return iso;
  }
}

function formatFullDate(iso: string): string {
  try {
    return new Intl.DateTimeFormat(undefined, {
      year: 'numeric', month: 'short', day: 'numeric',
      hour: '2-digit', minute: '2-digit',
    }).format(new Date(iso));
  } catch {
    return iso;
  }
}
