/**
 * Escapes `&`, `<`, `>` for safe interpolation into `dangerouslySetInnerHTML`
 * HTML strings. Shared by every component that hand-builds a small HTML
 * fragment (diff rendering, issue-ref linkification) rather than each
 * re-declaring its own copy.
 */
export function escapeHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}
