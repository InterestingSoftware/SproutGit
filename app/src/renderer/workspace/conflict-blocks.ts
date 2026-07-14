/**
 * Parses/resolves `<<<<<<<` / `=======` / `>>>>>>>` conflict markers that git
 * leaves in a working-tree file after a conflicted merge/rebase/cherry-pick.
 * Also tolerates the diff3 style (`merge.conflictStyle=diff3`), which adds a
 * `|||||||` common-ancestor section between the ours and theirs halves —
 * that section is dropped rather than surfaced, since this view doesn't show
 * a base pane.
 */

export type ConflictBlock = {
  id: string;
  oursLabel: string;
  theirsLabel: string;
  oursText: string;
  theirsText: string;
  /** Character offset of the block's `<<<<<<<` line, in the text it was parsed from. */
  startIndex: number;
  /** Character offset just past the block's `>>>>>>>` line (start of the next line, or EOF). */
  endIndex: number;
};

export type ParsedConflictFile = {
  raw: string;
  blocks: ConflictBlock[];
};

export type ConflictResolution = 'ours' | 'theirs' | 'both';

/** Parses every conflict marker block out of `raw`, in document order. */
export function parseConflictMarkers(raw: string): ParsedConflictFile {
  const lines = raw.split('\n');
  const lineStart: number[] = [];
  let offset = 0;
  for (const line of lines) {
    lineStart.push(offset);
    offset += line.length + 1;
  }

  const blocks: ConflictBlock[] = [];
  let i = 0;
  let blockIndex = 0;

  while (i < lines.length) {
    const line = lines[i]!;
    if (!line.startsWith('<<<<<<<')) {
      i++;
      continue;
    }

    const startIndex = lineStart[i]!;
    const oursLabel = line.slice(7).trim();
    i++;

    const oursLines: string[] = [];
    while (i < lines.length && !lines[i]!.startsWith('=======') && !lines[i]!.startsWith('|||||||')) {
      oursLines.push(lines[i]!);
      i++;
    }

    if (i < lines.length && lines[i]!.startsWith('|||||||')) {
      i++;
      while (i < lines.length && !lines[i]!.startsWith('=======')) i++;
    }

    if (i >= lines.length) break; // Malformed/truncated block — stop parsing rather than misreport it.
    i++; // skip the '=======' separator

    const theirsLines: string[] = [];
    while (i < lines.length && !lines[i]!.startsWith('>>>>>>>')) {
      theirsLines.push(lines[i]!);
      i++;
    }

    if (i >= lines.length) break; // Malformed/truncated block.
    const theirsLabel = lines[i]!.slice(7).trim();
    i++; // move past the '>>>>>>>' line
    const endIndex = i < lines.length ? lineStart[i]! : raw.length;

    blocks.push({
      id: `block-${blockIndex++}`,
      oursLabel,
      theirsLabel,
      oursText: oursLines.join('\n'),
      theirsText: theirsLines.join('\n'),
      startIndex,
      endIndex,
    });
  }

  return { raw, blocks };
}

/**
 * Replaces one conflict block's marker span with its resolved content and
 * returns the new full text. Every other block (resolved or not) is left
 * byte-for-byte untouched.
 */
export function resolveConflictBlock(raw: string, block: ConflictBlock, resolution: ConflictResolution): string {
  const content =
    resolution === 'ours' ? block.oursText :
    resolution === 'theirs' ? block.theirsText :
    [block.oursText, block.theirsText].filter(s => s.length > 0).join('\n');

  const replacement = content.length > 0 ? `${content}\n` : '';
  return raw.slice(0, block.startIndex) + replacement + raw.slice(block.endIndex);
}
