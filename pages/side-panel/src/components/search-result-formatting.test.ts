import { parseSearchResults } from '@extension/ui';
import { describe, expect, it } from 'vitest';

describe('parseSearchResults', () => {
  it('parses valid search results', () => {
    const data = [
      { title: 'Example', url: 'https://example.com', snippet: 'An example page' },
      { title: 'Test', url: 'https://test.com', snippet: 'A test page' },
    ];
    const results = parseSearchResults(data);
    expect(results).toHaveLength(2);
    expect(results[0].title).toBe('Example');
    expect(results[0].url).toBe('https://example.com');
    expect(results[0].snippet).toBe('An example page');
  });

  it('returns empty array for non-array input', () => {
    expect(parseSearchResults(null)).toEqual([]);
    expect(parseSearchResults(undefined)).toEqual([]);
    expect(parseSearchResults('string')).toEqual([]);
    expect(parseSearchResults(42)).toEqual([]);
    expect(parseSearchResults({})).toEqual([]);
  });

  it('filters out invalid items', () => {
    const data = [
      { title: 'Valid', url: 'https://example.com', snippet: 'ok' },
      { title: 123, url: 'bad', snippet: 'not string title' },
      { url: 'missing-title', snippet: 'no title' },
      null,
      'string item',
    ];
    const results = parseSearchResults(data);
    expect(results).toHaveLength(1);
    expect(results[0].title).toBe('Valid');
  });

  it('returns empty array for empty array input', () => {
    expect(parseSearchResults([])).toEqual([]);
  });

  it('handles items with extra properties', () => {
    const data = [{ title: 'Extra', url: 'https://extra.com', snippet: 'Has extras', score: 0.95 }];
    const results = parseSearchResults(data);
    expect(results).toHaveLength(1);
    expect(results[0].title).toBe('Extra');
  });
});
