/**
 * Score how well `query` fuzzy-matches `target` as an ordered subsequence
 * (like VS Code/Sublime "fuzzy find"). Returns `null` when query is not a
 * subsequence of target. Higher scores are better matches; consecutive
 * character runs and matches at word boundaries score higher than scattered
 * single-character hits.
 */
export function fuzzyScore(query: string, target: string): number | null {
  const q = query.trim().toLowerCase();
  if (!q) return 0;
  const t = target.toLowerCase();

  let qi = 0;
  let score = 0;
  let prevMatchIndex = -1;
  for (let ti = 0; ti < t.length && qi < q.length; ti++) {
    if (t[ti] !== q[qi]) continue;
    const consecutive = prevMatchIndex === ti - 1;
    const wordStart = ti === 0 || /[\s\-_/]/.test(t[ti - 1] ?? '');
    score += 1 + (consecutive ? 2 : 0) + (wordStart ? 1 : 0);
    prevMatchIndex = ti;
    qi++;
  }
  if (qi < q.length) return null;
  // Slightly favor shorter/more-precise targets among equal-quality matches.
  return score - t.length * 0.01;
}
