/**
 * Tokenizes a command string on whitespace, honoring a quoted segment at the
 * *start* of each token (e.g. `"/Applications/Visual Studio Code.app/.../code"
 * --wait` becomes `['/Applications/Visual Studio Code.app/.../code', '--wait']`,
 * quotes stripped) — mirrors the main process's tokenizeCommand() in
 * tool-test-helpers.ts (duplicated here since the renderer can't import
 * main-process code across the IPC boundary).
 *
 * A naive whitespace split breaks on any quoted path containing spaces
 * (common on Windows, and for macOS .app bundle paths) — splitting on every
 * space, including the ones inside the quotes, mangles the value. A quote is
 * only special when it opens a token; a quote appearing mid-token is left
 * alone so values containing literal quote characters as data aren't mangled.
 */
export function tokenizeCommand(raw: string): string[] {
  const tokens: string[] = [];
  let i = 0;
  const n = raw.length;
  while (i < n) {
    while (i < n && /\s/.test(raw[i]!)) i++;
    if (i >= n) break;
    const quote = raw[i] === '"' || raw[i] === "'" ? raw[i] : null;
    if (quote) {
      i++;
      let token = '';
      while (i < n && raw[i] !== quote) {
        token += raw[i];
        i++;
      }
      if (i < n) i++; // skip the closing quote
      tokens.push(token);
    } else {
      let token = '';
      while (i < n && !/\s/.test(raw[i]!)) {
        token += raw[i];
        i++;
      }
      tokens.push(token);
    }
  }
  return tokens;
}
