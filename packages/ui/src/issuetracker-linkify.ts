import type { IssueTrackerPattern, IssueMatch } from '@sproutgit/types';

function escapeHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function escapeAttr(s: string): string {
  return escapeHtml(s).replace(/"/g, '&quot;');
}

/**
 * Turns issue references in `text` (e.g. "ABCD-123") into `<a>` tags per the
 * repo's `.issuetracker` patterns, HTML-escaping everything else. Returns an
 * HTML string for `dangerouslySetInnerHTML`. A pattern whose regex fails to
 * compile (a hand-edited file) is skipped rather than throwing.
 */
export function linkifyIssueRefs(text: string, patterns: IssueTrackerPattern[]): string {
  if (patterns.length === 0) return escapeHtml(text);

  type Segment = { start: number; end: number; html: string };
  const segments: Segment[] = [];

  for (const pattern of patterns) {
    let regex: RegExp;
    try {
      regex = new RegExp(pattern.regex, 'g');
    } catch {
      continue;
    }
    for (const match of text.matchAll(regex)) {
      if (match.index === undefined) continue;
      const start = match.index;
      const end = start + match[0].length;
      // Skip if this span overlaps an already-claimed match from an earlier pattern.
      if (segments.some(s => start < s.end && end > s.start)) continue;

      const url = pattern.url.replace(/\$(\d+)/g, (_, groupIdx: string) => match[Number(groupIdx)] ?? '');
      segments.push({
        start,
        end,
        html: `<a href="${escapeAttr(url)}">${escapeHtml(match[0])}</a>`,
      });
    }
  }

  if (segments.length === 0) return escapeHtml(text);
  segments.sort((a, b) => a.start - b.start);

  let out = '';
  let cursor = 0;
  for (const seg of segments) {
    out += escapeHtml(text.slice(cursor, seg.start));
    out += seg.html;
    cursor = seg.end;
  }
  out += escapeHtml(text.slice(cursor));
  return out;
}

/**
 * Matches free-form text (e.g. a pasted issue ref or URL) against the repo's
 * `.issuetracker` patterns, returning the first match. Unlike `linkifyIssueRefs`
 * this tests the whole input rather than scanning within a longer string —
 * used when a user types/pastes a single issue reference into a form field.
 */
export function matchIssueRef(text: string, patterns: IssueTrackerPattern[]): IssueMatch | null {
  const trimmed = text.trim();
  if (!trimmed) return null;

  for (const pattern of patterns) {
    let regex: RegExp;
    try {
      regex = new RegExp(pattern.regex);
    } catch {
      continue;
    }
    const match = regex.exec(trimmed);
    if (!match) continue;
    const url = pattern.url.replace(/\$(\d+)/g, (_, groupIdx: string) => match[Number(groupIdx)] ?? '');
    return { label: pattern.label, ref: match[0], url };
  }
  return null;
}
