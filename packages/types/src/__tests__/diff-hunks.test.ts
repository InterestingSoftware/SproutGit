import { describe, it, expect } from 'vitest';
import { parseFileDiff, buildHunkPatch } from '../diff-hunks.js';

const SINGLE_HUNK_DIFF = [
  'diff --git a/foo.txt b/foo.txt',
  'index 1111111..2222222 100644',
  '--- a/foo.txt',
  '+++ b/foo.txt',
  '@@ -1,3 +1,4 @@',
  ' one',
  '+two',
  ' three',
  '-four',
  '+four modified',
  '',
].join('\n');

const TWO_HUNK_DIFF = [
  'diff --git a/bar.txt b/bar.txt',
  'index 3333333..4444444 100644',
  '--- a/bar.txt',
  '+++ b/bar.txt',
  '@@ -1,2 +1,3 @@',
  ' alpha',
  '+beta',
  ' gamma',
  '@@ -10,2 +11,2 @@',
  '-delta',
  '+delta modified',
  ' epsilon',
  '',
].join('\n');

describe('parseFileDiff', () => {
  it('returns null for empty input', () => {
    expect(parseFileDiff('')).toBeNull();
    expect(parseFileDiff('   \n  ')).toBeNull();
  });

  it('parses file header lines verbatim', () => {
    const parsed = parseFileDiff(SINGLE_HUNK_DIFF);
    expect(parsed?.headerLines).toEqual([
      'diff --git a/foo.txt b/foo.txt',
      'index 1111111..2222222 100644',
      '--- a/foo.txt',
      '+++ b/foo.txt',
    ]);
    expect(parsed?.oldPath).toBe('foo.txt');
    expect(parsed?.newPath).toBe('foo.txt');
  });

  it('parses a single hunk into context/add/del lines', () => {
    const parsed = parseFileDiff(SINGLE_HUNK_DIFF);
    expect(parsed?.hunks).toHaveLength(1);
    const hunk = parsed?.hunks[0];
    expect(hunk?.oldStart).toBe(1);
    expect(hunk?.oldLines).toBe(3);
    expect(hunk?.newStart).toBe(1);
    expect(hunk?.newLines).toBe(4);
    expect(hunk?.lines).toEqual([
      { kind: 'context', content: 'one' },
      { kind: 'add', content: 'two' },
      { kind: 'context', content: 'three' },
      { kind: 'del', content: 'four' },
      { kind: 'add', content: 'four modified' },
    ]);
  });

  it('parses multiple hunks in one file diff', () => {
    const parsed = parseFileDiff(TWO_HUNK_DIFF);
    expect(parsed?.hunks).toHaveLength(2);
    expect(parsed?.hunks[0]?.lines.map(l => l.kind)).toEqual(['context', 'add', 'context']);
    expect(parsed?.hunks[1]?.lines.map(l => l.kind)).toEqual(['del', 'add', 'context']);
    expect(parsed?.hunks[1]?.oldStart).toBe(10);
    expect(parsed?.hunks[1]?.newStart).toBe(11);
  });

  it('recognizes a deleted file (--- a/path, +++ /dev/null)', () => {
    const diff = [
      'diff --git a/gone.txt b/gone.txt',
      'deleted file mode 100644',
      'index 1111111..0000000 100644',
      '--- a/gone.txt',
      '+++ /dev/null',
      '@@ -1,1 +0,0 @@',
      '-bye',
      '',
    ].join('\n');
    const parsed = parseFileDiff(diff);
    expect(parsed?.oldPath).toBe('gone.txt');
    expect(parsed?.newPath).toBeNull();
  });

  it('attaches noNewlineAtEof to the preceding line', () => {
    const diff = [
      'diff --git a/no-eol.txt b/no-eol.txt',
      'index 1111111..2222222 100644',
      '--- a/no-eol.txt',
      '+++ b/no-eol.txt',
      '@@ -1,1 +1,1 @@',
      '-old',
      '\\ No newline at end of file',
      '+new',
      '\\ No newline at end of file',
      '',
    ].join('\n');
    const parsed = parseFileDiff(diff);
    const lines = parsed?.hunks[0]?.lines;
    expect(lines?.[0]).toMatchObject({ kind: 'del', content: 'old', noNewlineAtEof: true });
    expect(lines?.[1]).toMatchObject({ kind: 'add', content: 'new', noNewlineAtEof: true });
  });

  it('does not misparse an added line whose content starts with "@@"', () => {
    const diff = [
      'diff --git a/weird.txt b/weird.txt',
      'index 1111111..2222222 100644',
      '--- a/weird.txt',
      '+++ b/weird.txt',
      '@@ -1,1 +1,2 @@',
      ' keep',
      '+@@ looks like a header @@',
      '',
    ].join('\n');
    const parsed = parseFileDiff(diff);
    expect(parsed?.hunks).toHaveLength(1);
    expect(parsed?.hunks[0]?.lines).toEqual([
      { kind: 'context', content: 'keep' },
      { kind: 'add', content: '@@ looks like a header @@' },
    ]);
  });
});

describe('buildHunkPatch', () => {
  it('throws for an out-of-range hunk index', () => {
    const parsed = parseFileDiff(SINGLE_HUNK_DIFF)!;
    expect(() => buildHunkPatch(parsed, 5)).toThrow(/out of range/);
  });

  it('builds a full-hunk patch reusing the original file headers', () => {
    const parsed = parseFileDiff(SINGLE_HUNK_DIFF)!;
    const patch = buildHunkPatch(parsed, 0);
    expect(patch).toBe([
      'diff --git a/foo.txt b/foo.txt',
      'index 1111111..2222222 100644',
      '--- a/foo.txt',
      '+++ b/foo.txt',
      '@@ -1,3 +1,4 @@',
      ' one',
      '+two',
      ' three',
      '-four',
      '+four modified',
      '',
    ].join('\n'));
  });

  it('builds a patch for a specific hunk when the file has several', () => {
    const parsed = parseFileDiff(TWO_HUNK_DIFF)!;
    const patch = buildHunkPatch(parsed, 1);
    expect(patch).toContain('@@ -10,2 +11,2 @@');
    expect(patch).toContain('-delta');
    expect(patch).not.toContain('+beta');
  });

  it('drops a deselected add line entirely and recounts the header', () => {
    const parsed = parseFileDiff(SINGLE_HUNK_DIFF)!;
    // hunk.lines: [context one(0), add two(1), context three(2), del four(3), add four-modified(4)]
    // Select only the del (index 3) and the second add (index 4); drop the first add (index 1).
    const patch = buildHunkPatch(parsed, 0, [3, 4]);
    const lines = patch.split('\n');
    expect(lines).toContain(' one');
    expect(lines).not.toContain('+two');
    expect(lines).toContain(' three');
    expect(lines).toContain('-four');
    expect(lines).toContain('+four modified');
    // old: one, three, four (deleted) = 3; new: one, three, four modified = 3
    expect(lines).toContain('@@ -1,3 +1,3 @@');
  });

  it('keeps a deselected del line as context and recounts the header', () => {
    const parsed = parseFileDiff(SINGLE_HUNK_DIFF)!;
    // Select only the first add (index 1); deselect the del (index 3) and the second add (index 4).
    const patch = buildHunkPatch(parsed, 0, [1]);
    const lines = patch.split('\n');
    expect(lines).toContain(' one');
    expect(lines).toContain('+two');
    expect(lines).toContain(' three');
    expect(lines).toContain(' four'); // kept as context, not deleted
    expect(lines).not.toContain('-four');
    expect(lines).not.toContain('+four modified');
    // old: one, three, four = 3; new: one, two, three, four = 4
    expect(lines).toContain('@@ -1,3 +1,4 @@');
  });

  it('selecting nothing keeps only context lines', () => {
    const parsed = parseFileDiff(SINGLE_HUNK_DIFF)!;
    const patch = buildHunkPatch(parsed, 0, []);
    const lines = patch.split('\n');
    const body = lines.slice(lines.indexOf('@@ -1,3 +1,3 @@') + 1);
    expect(body).toContain(' one');
    expect(body).toContain(' three');
    expect(body).toContain(' four'); // del kept as context
    expect(body.some(l => l.startsWith('+') || l.startsWith('-'))).toBe(false);
  });
});
