import { normalizeCacheKey, readCache, writeCache } from './web-shared';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { CacheEntry } from './web-shared';

describe('normalizeCacheKey', () => {
  it('trims whitespace and lowercases', () => {
    expect(normalizeCacheKey('  Hello World  ')).toBe('hello world');
  });

  it('handles empty string', () => {
    expect(normalizeCacheKey('')).toBe('');
  });

  it('handles already normalized string', () => {
    expect(normalizeCacheKey('test query')).toBe('test query');
  });
});

describe('readCache / writeCache', () => {
  let cache: Map<string, CacheEntry<string>>;

  beforeEach(() => {
    cache = new Map();
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('round-trips a cached value', () => {
    writeCache(cache, 'key1', 'value1');
    expect(readCache(cache, 'key1', 60_000)).toBe('value1');
  });

  it('returns null for missing key', () => {
    expect(readCache(cache, 'missing', 60_000)).toBeNull();
  });

  it('returns null for expired entry', () => {
    writeCache(cache, 'key1', 'value1');
    // Advance time past TTL
    vi.advanceTimersByTime(61_000);
    expect(readCache(cache, 'key1', 60_000)).toBeNull();
    // Entry should be deleted
    expect(cache.has('key1')).toBe(false);
  });

  it('returns value within TTL', () => {
    writeCache(cache, 'key1', 'value1');
    vi.advanceTimersByTime(30_000);
    expect(readCache(cache, 'key1', 60_000)).toBe('value1');
  });

  it('evicts oldest entry when at max capacity', () => {
    writeCache(cache, 'a', '1', 3);
    writeCache(cache, 'b', '2', 3);
    writeCache(cache, 'c', '3', 3);
    // Cache is now at max (3)
    writeCache(cache, 'd', '4', 3);
    // Oldest entry 'a' should be evicted
    expect(readCache(cache, 'a', 60_000)).toBeNull();
    expect(readCache(cache, 'b', 60_000)).toBe('2');
    expect(readCache(cache, 'd', 60_000)).toBe('4');
  });
});
