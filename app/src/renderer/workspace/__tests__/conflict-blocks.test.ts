import { describe, it, expect } from 'vitest';
import { parseConflictMarkers, resolveConflictBlock } from '../conflict-blocks.js';

const SINGLE_CONFLICT = [
  'line before',
  '<<<<<<< HEAD',
  'our line',
  '=======',
  'their line',
  '>>>>>>> feature',
  'line after',
  '',
].join('\n');

describe('parseConflictMarkers', () => {
  it('returns no blocks for a file with no markers', () => {
    const parsed = parseConflictMarkers('just\nplain\ntext\n');
    expect(parsed.blocks).toHaveLength(0);
  });

  it('parses a single conflict block with labels and content', () => {
    const parsed = parseConflictMarkers(SINGLE_CONFLICT);
    expect(parsed.blocks).toHaveLength(1);
    expect(parsed.blocks[0]).toMatchObject({
      oursLabel: 'HEAD',
      theirsLabel: 'feature',
      oursText: 'our line',
      theirsText: 'their line',
    });
  });

  it('parses multiple conflict blocks in document order', () => {
    const raw = [
      '<<<<<<< HEAD',
      'a1',
      '=======',
      'b1',
      '>>>>>>> feature',
      'unchanged',
      '<<<<<<< HEAD',
      'a2',
      '=======',
      'b2',
      '>>>>>>> feature',
      '',
    ].join('\n');
    const parsed = parseConflictMarkers(raw);
    expect(parsed.blocks).toHaveLength(2);
    expect(parsed.blocks[0]?.oursText).toBe('a1');
    expect(parsed.blocks[1]?.oursText).toBe('a2');
  });

  it('drops the diff3-style common-ancestor section', () => {
    const raw = [
      '<<<<<<< HEAD',
      'ours',
      '||||||| base',
      'base content',
      '=======',
      'theirs',
      '>>>>>>> feature',
      '',
    ].join('\n');
    const parsed = parseConflictMarkers(raw);
    expect(parsed.blocks).toHaveLength(1);
    expect(parsed.blocks[0]?.oursText).toBe('ours');
    expect(parsed.blocks[0]?.theirsText).toBe('theirs');
  });

  it('handles multi-line ours/theirs sections', () => {
    const raw = [
      '<<<<<<< HEAD',
      'a1',
      'a2',
      '=======',
      'b1',
      'b2',
      'b3',
      '>>>>>>> feature',
      '',
    ].join('\n');
    const parsed = parseConflictMarkers(raw);
    expect(parsed.blocks[0]?.oursText).toBe('a1\na2');
    expect(parsed.blocks[0]?.theirsText).toBe('b1\nb2\nb3');
  });
});

describe('resolveConflictBlock', () => {
  it('replaces the block with the ours content', () => {
    const parsed = parseConflictMarkers(SINGLE_CONFLICT);
    const result = resolveConflictBlock(SINGLE_CONFLICT, parsed.blocks[0]!, 'ours');
    expect(result).toBe('line before\nour line\nline after\n');
  });

  it('replaces the block with the theirs content', () => {
    const parsed = parseConflictMarkers(SINGLE_CONFLICT);
    const result = resolveConflictBlock(SINGLE_CONFLICT, parsed.blocks[0]!, 'theirs');
    expect(result).toBe('line before\ntheir line\nline after\n');
  });

  it('replaces the block with both, ours first', () => {
    const parsed = parseConflictMarkers(SINGLE_CONFLICT);
    const result = resolveConflictBlock(SINGLE_CONFLICT, parsed.blocks[0]!, 'both');
    expect(result).toBe('line before\nour line\ntheir line\nline after\n');
  });

  it('removes the block entirely when the chosen side is empty', () => {
    const raw = ['<<<<<<< HEAD', '=======', 'theirs', '>>>>>>> feature', 'after', ''].join('\n');
    const parsed = parseConflictMarkers(raw);
    const result = resolveConflictBlock(raw, parsed.blocks[0]!, 'ours');
    expect(result).toBe('after\n');
  });

  it('leaves other blocks untouched when resolving one of several', () => {
    const raw = [
      '<<<<<<< HEAD',
      'a1',
      '=======',
      'b1',
      '>>>>>>> feature',
      'unchanged',
      '<<<<<<< HEAD',
      'a2',
      '=======',
      'b2',
      '>>>>>>> feature',
      '',
    ].join('\n');
    const parsed = parseConflictMarkers(raw);
    const afterFirst = resolveConflictBlock(raw, parsed.blocks[0]!, 'ours');

    expect(afterFirst).toBe(
      ['a1', 'unchanged', '<<<<<<< HEAD', 'a2', '=======', 'b2', '>>>>>>> feature', ''].join('\n')
    );

    const reparsed = parseConflictMarkers(afterFirst);
    expect(reparsed.blocks).toHaveLength(1);
    expect(reparsed.blocks[0]?.oursText).toBe('a2');
  });
});
