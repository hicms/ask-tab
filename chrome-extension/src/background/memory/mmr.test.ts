import { mmrRerank, jaccardSimilarity, tokenizeForJaccard } from './mmr';
import { describe, it, expect } from 'vitest';
import type { MMRConfig } from './mmr';

const makeItem = (score: number, text: string) => ({ score, text });

describe('mmrRerank', () => {
  it('passes through when disabled', () => {
    const items = [makeItem(1.0, 'hello world'), makeItem(0.5, 'hello world')];
    const config: MMRConfig = { enabled: false, lambda: 0.7 };
    const result = mmrRerank(items, config);
    expect(result).toBe(items); // same reference
  });

  it('passes through single item', () => {
    const items = [makeItem(1.0, 'hello world')];
    const result = mmrRerank(items);
    expect(result).toEqual(items);
  });

  it('passes through empty array', () => {
    const result = mmrRerank([]);
    expect(result).toEqual([]);
  });

  it('penalizes identical texts — diverse items promoted', () => {
    const items = [
      makeItem(1.0, 'the quick brown fox jumps over the lazy dog'),
      makeItem(0.9, 'the quick brown fox jumps over the lazy dog'), // identical text
      makeItem(0.8, 'completely different content about programming languages'),
    ];
    const result = mmrRerank(items, { enabled: true, lambda: 0.5 });

    // First item should still be highest relevance
    expect(result[0]).toBe(items[0]);
    // Third item (diverse) should be promoted above second (duplicate)
    expect(result[1]).toBe(items[2]);
    expect(result[2]).toBe(items[1]);
  });

  it('lambda=1 produces pure relevance ordering', () => {
    const items = [
      makeItem(0.5, 'same text here'),
      makeItem(1.0, 'same text here'),
      makeItem(0.7, 'same text here'),
    ];
    const result = mmrRerank(items, { enabled: true, lambda: 1.0 });

    // Should be sorted by score descending
    expect(result[0]!.score).toBe(1.0);
    expect(result[1]!.score).toBe(0.7);
    expect(result[2]!.score).toBe(0.5);
  });

  it('lambda=0 maximizes diversity', () => {
    const items = [
      makeItem(1.0, 'apple banana cherry'),
      makeItem(0.9, 'apple banana cherry'), // duplicate
      makeItem(0.3, 'xyz uvw rst'), // completely different
    ];
    const result = mmrRerank(items, { enabled: true, lambda: 0 });

    // First picked is arbitrary (all relevance=0 contribution), but then
    // the most different from it should follow
    expect(result.length).toBe(3);
  });

  it('preserves all items in output', () => {
    const items = [
      makeItem(1.0, 'hello world'),
      makeItem(0.8, 'foo bar baz'),
      makeItem(0.6, 'hello world'),
      makeItem(0.4, 'unique content'),
    ];
    const result = mmrRerank(items);
    expect(result.length).toBe(items.length);
    // All original items should be present
    for (const item of items) {
      expect(result).toContain(item);
    }
  });

  it('handles items with zero scores', () => {
    const items = [makeItem(0, 'hello'), makeItem(0, 'world')];
    const result = mmrRerank(items);
    expect(result.length).toBe(2);
  });
});

describe('jaccardSimilarity', () => {
  it('returns 1 for identical sets', () => {
    const a = new Set(['hello', 'world']);
    expect(jaccardSimilarity(a, a)).toBe(1);
  });

  it('returns 0 for disjoint sets', () => {
    const a = new Set(['hello']);
    const b = new Set(['world']);
    expect(jaccardSimilarity(a, b)).toBe(0);
  });

  it('returns 1 for two empty sets', () => {
    expect(jaccardSimilarity(new Set(), new Set())).toBe(1);
  });

  it('returns 0 when one set is empty', () => {
    expect(jaccardSimilarity(new Set(['a']), new Set())).toBe(0);
  });

  it('computes correct partial overlap', () => {
    const a = new Set(['a', 'b', 'c']);
    const b = new Set(['b', 'c', 'd']);
    // intersection = {b,c} = 2, union = {a,b,c,d} = 4
    expect(jaccardSimilarity(a, b)).toBe(0.5);
  });
});

describe('tokenizeForJaccard', () => {
  it('lowercases and extracts alphanumeric tokens', () => {
    const tokens = tokenizeForJaccard('Hello World 123');
    expect(tokens).toContain('hello');
    expect(tokens).toContain('world');
    expect(tokens).toContain('123');
  });

  it('returns empty set for empty string', () => {
    expect(tokenizeForJaccard('').size).toBe(0);
  });

  it('handles underscores as part of tokens', () => {
    const tokens = tokenizeForJaccard('my_variable_name');
    expect(tokens).toContain('my_variable_name');
  });
});
