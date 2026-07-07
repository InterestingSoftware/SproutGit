import { describe, it, expect } from 'vitest';
import { fuzzyScore, fuzzyFilterSort } from '../fuzzy.js';

describe('fuzzyScore', () => {
  it('returns 0 for a blank query', () => {
    expect(fuzzyScore('', 'anything')).toBe(0);
  });

  it('matches a subsequence regardless of case', () => {
    expect(fuzzyScore('gpt4', 'GPT-4 Turbo')).not.toBeNull();
  });

  it('returns null when the query is not a subsequence', () => {
    expect(fuzzyScore('xyz', 'GPT-4 Turbo')).toBeNull();
  });

  it('scores an exact substring match higher than a scattered subsequence match', () => {
    const exact = fuzzyScore('claude', 'claude-3.5-sonnet');
    const scattered = fuzzyScore('cle', 'claude-3.5-sonnet');
    expect(exact).not.toBeNull();
    expect(scattered).not.toBeNull();
    expect(exact!).toBeGreaterThan(scattered!);
  });

  it('scores a match at the start higher than the same match later in the string', () => {
    const early = fuzzyScore('gpt', 'gpt-4o-mini');
    const late = fuzzyScore('gpt', 'chatgpt-clone');
    expect(early).not.toBeNull();
    expect(late).not.toBeNull();
    expect(early!).toBeGreaterThan(late!);
  });
});

describe('fuzzyFilterSort', () => {
  const items = ['GPT-4o', 'GPT-4o mini', 'Claude 3.5 Sonnet', 'Gemini 1.5 Pro'];

  it('returns all items, unsorted, when the query is blank', () => {
    expect(fuzzyFilterSort(items, '', (s) => s)).toEqual(items);
  });

  it('filters out non-matching items', () => {
    const result = fuzzyFilterSort(items, 'claude', (s) => s);
    expect(result).toEqual(['Claude 3.5 Sonnet']);
  });

  it('ranks closer matches first', () => {
    const result = fuzzyFilterSort(items, 'gpt4o', (s) => s);
    expect(result[0]).toBe('GPT-4o');
  });

  it('matches nothing when the query has characters absent from every item', () => {
    expect(fuzzyFilterSort(items, 'zzz', (s) => s)).toEqual([]);
  });
});
