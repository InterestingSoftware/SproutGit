/**
 * Pure parsing and patch-construction for the unified diff of a single file.
 * Shared between the renderer (rendering per-hunk / per-line staging controls)
 * and the git package (building the `git apply --cached` patch for hunk/line
 * staging) — same sharing rationale as `validateBranchName` in validation.ts.
 */

export type DiffLineKind = 'context' | 'add' | 'del';

export type DiffLine = {
  kind: DiffLineKind;
  /** Line content without the leading ' ' / '+' / '-' marker. */
  content: string;
  /** Set when immediately followed by a "\ No newline at end of file" marker. */
  noNewlineAtEof?: boolean;
};

export type DiffHunk = {
  /** Original "@@ -a,b +c,d @@" header line, verbatim. */
  header: string;
  oldStart: number;
  oldLines: number;
  newStart: number;
  newLines: number;
  lines: DiffLine[];
};

export type ParsedFileDiff = {
  oldPath: string | null;
  newPath: string | null;
  /** Lines from "diff --git ..." through "+++ ..." inclusive, reused verbatim when rebuilding a patch. */
  headerLines: string[];
  hunks: DiffHunk[];
};

const HUNK_HEADER_RE = /^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@/;
const NO_NEWLINE_MARKER = '\\ No newline at end of file';

/** Parses the unified diff for a single file (as produced by `git diff -- <path>`). */
export function parseFileDiff(raw: string): ParsedFileDiff | null {
  if (!raw.trim()) return null;

  const lines = raw.split('\n');
  // Drop the single trailing empty element produced by the diff's final newline.
  if (lines.length > 0 && lines[lines.length - 1] === '') lines.pop();

  let i = 0;
  const headerLines: string[] = [];
  let oldPath: string | null = null;
  let newPath: string | null = null;

  while (i < lines.length && !HUNK_HEADER_RE.test(lines[i] ?? '')) {
    const line = lines[i] ?? '';
    if (line.startsWith('--- ')) oldPath = normalizeDiffPath(line.slice(4));
    if (line.startsWith('+++ ')) newPath = normalizeDiffPath(line.slice(4));
    headerLines.push(line);
    i++;
  }

  if (headerLines.length === 0) return null;

  const hunks: DiffHunk[] = [];
  while (i < lines.length) {
    const headerLine = lines[i] ?? '';
    const m = HUNK_HEADER_RE.exec(headerLine);
    if (!m) break;

    const oldStart = Number(m[1]);
    const oldLines = m[2] !== undefined ? Number(m[2]) : 1;
    const newStart = Number(m[3]);
    const newLines = m[4] !== undefined ? Number(m[4]) : 1;
    i++;

    const hunkLines: DiffLine[] = [];
    while (i < lines.length) {
      const line = lines[i] ?? '';
      if (HUNK_HEADER_RE.test(line) || line.startsWith('diff --git')) break;

      if (line === NO_NEWLINE_MARKER) {
        const last = hunkLines[hunkLines.length - 1];
        if (last) last.noNewlineAtEof = true;
        i++;
        continue;
      }

      const marker = line.length > 0 ? line[0] : ' ';
      const content = line.length > 0 ? line.slice(1) : '';
      if (marker === '+') hunkLines.push({ kind: 'add', content });
      else if (marker === '-') hunkLines.push({ kind: 'del', content });
      else hunkLines.push({ kind: 'context', content });
      i++;
    }

    hunks.push({ header: headerLine, oldStart, oldLines, newStart, newLines, lines: hunkLines });
  }

  return { oldPath, newPath, headerLines, hunks };
}

function normalizeDiffPath(pathPart: string): string | null {
  if (pathPart === '/dev/null') return null;
  return pathPart.replace(/^[ab]\//, '');
}

/**
 * Builds a standalone patch containing exactly one hunk from `fileDiff`,
 * suitable for `git apply --cached` (stage) or `git apply --cached --reverse`
 * (unstage).
 *
 * When `selectedLineIndices` is omitted, the whole hunk is included. When
 * provided, it's the set of `hunk.lines` indices (add/del lines only) the
 * user wants applied — a deselected 'add' line is dropped entirely (as if
 * never added) and a deselected 'del' line is kept as context (as if never
 * removed). This mirrors the algorithm `git add -p` uses for per-line
 * staging, and works symmetrically for unstaging since that's just applying
 * the index-vs-HEAD diff in reverse.
 *
 * Old/new start offsets are kept verbatim from the source hunk — git only
 * uses them as a position hint and matches on context, so they don't need
 * to be recomputed when lines are dropped or converted to context.
 */
export function buildHunkPatch(
  fileDiff: ParsedFileDiff,
  hunkIndex: number,
  selectedLineIndices?: readonly number[] | null
): string {
  const hunk = fileDiff.hunks[hunkIndex];
  if (!hunk) {
    throw new Error(`Hunk index ${hunkIndex} is out of range (file has ${fileDiff.hunks.length} hunk(s))`);
  }

  const selected = selectedLineIndices ? new Set(selectedLineIndices) : null;

  const body: string[] = [];
  let oldCount = 0;
  let newCount = 0;

  hunk.lines.forEach((line, idx) => {
    const isSelected = selected === null || selected.has(idx);

    if (line.kind === 'context') {
      body.push(` ${line.content}`);
      oldCount++;
      newCount++;
      if (line.noNewlineAtEof) body.push(NO_NEWLINE_MARKER);
      return;
    }

    if (line.kind === 'add') {
      if (!isSelected) return; // dropped: never added
      body.push(`+${line.content}`);
      newCount++;
      if (line.noNewlineAtEof) body.push(NO_NEWLINE_MARKER);
      return;
    }

    // 'del'
    if (isSelected) {
      body.push(`-${line.content}`);
      oldCount++;
    } else {
      body.push(` ${line.content}`); // kept: never removed
      oldCount++;
      newCount++;
    }
    if (line.noNewlineAtEof) body.push(NO_NEWLINE_MARKER);
  });

  const newHunkHeader = `@@ -${hunk.oldStart},${oldCount} +${hunk.newStart},${newCount} @@`;

  return [...fileDiff.headerLines, newHunkHeader, ...body, ''].join('\n');
}
