/**
 * Lightweight fuzzy matcher for the searchable model picker (and anywhere
 * else a simple "type to filter" search is useful). No external dependency —
 * this repo has none of the usual fuzzy-search libs (fuse.js/fzf/cmdk)
 * already installed.
 *
 * Subsequence match: every character of `query` must appear in `text`, in
 * order, but not necessarily contiguous. Returns a score (higher = better
 * match) or `null` if `query` isn't a subsequence of `text` at all.
 */
export function fuzzyScore(query: string, text: string): number | null {
  const q = query.trim().toLowerCase();
  if (!q) return 0;
  const t = text.toLowerCase();

  let score = 0;
  let searchFrom = 0;
  let consecutiveRun = 0;
  let firstMatchIndex = -1;

  for (const ch of q) {
    const idx = t.indexOf(ch, searchFrom);
    if (idx === -1) return null;
    if (firstMatchIndex === -1) firstMatchIndex = idx;

    if (idx === searchFrom) {
      consecutiveRun += 1;
      score += 3 + consecutiveRun; // reward runs of consecutive matches
    } else {
      consecutiveRun = 0;
      score += 1;
    }
    searchFrom = idx + 1;
  }

  if (t.includes(q)) score += 15; // exact substring is a strong signal
  if (firstMatchIndex === 0) score += 5; // matches starting at the beginning rank higher
  score -= firstMatchIndex * 0.1; // slight penalty for matches starting later

  return score;
}

/**
 * Filters `items` to those where `getText(item)` fuzzy-matches `query`,
 * sorted best-match-first. Returns all items (in original order) when
 * `query` is blank.
 */
export function fuzzyFilterSort<T>(items: T[], query: string, getText: (item: T) => string): T[] {
  if (!query.trim()) return items;
  return items
    .map((item) => ({ item, score: fuzzyScore(query, getText(item)) }))
    .filter((r): r is { item: T; score: number } => r.score !== null)
    .sort((a, b) => b.score - a.score)
    .map((r) => r.item);
}
