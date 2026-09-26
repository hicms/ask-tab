// ---------------------------------------------------------------------------
// Shared cache / timeout / error utilities for web-based tools
// arrow function style per project conventions
// ---------------------------------------------------------------------------

interface CacheEntry<T> {
  data: T;
  timestamp: number;
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const DEFAULT_TIMEOUT_SECONDS = 30;
const DEFAULT_CACHE_TTL_MINUTES = 1;
const DEFAULT_MAX_CACHE_ENTRIES = 100;

// ---------------------------------------------------------------------------
// Cache helpers
// ---------------------------------------------------------------------------

/** Normalize a string for use as a cache key (trim + lowercase). */
const normalizeCacheKey = (key: string): string => key.trim().toLowerCase();

/** Read a cached entry if it exists and hasn't expired. */
const readCache = <T>(cache: Map<string, CacheEntry<T>>, key: string, ttlMs: number): T | null => {
  const entry = cache.get(key);
  if (!entry) return null;
  if (Date.now() - entry.timestamp > ttlMs) {
    cache.delete(key);
    return null;
  }
  return entry.data;
};

/** Write an entry to the cache, evicting the oldest if at capacity. */
const writeCache = <T>(
  cache: Map<string, CacheEntry<T>>,
  key: string,
  data: T,
  maxEntries: number = DEFAULT_MAX_CACHE_ENTRIES,
): void => {
  if (cache.size >= maxEntries) {
    // Evict oldest entry (first key in insertion order)
    const oldest = cache.keys().next().value;
    if (oldest !== undefined) {
      cache.delete(oldest);
    }
  }
  cache.set(key, { data, timestamp: Date.now() });
};

// ---------------------------------------------------------------------------
// Timeout helpers
// ---------------------------------------------------------------------------

/** Create an AbortSignal that times out after `seconds`. */
const withTimeout = (seconds: number): AbortSignal => AbortSignal.timeout(seconds * 1000);

// ---------------------------------------------------------------------------
// Error helpers
// ---------------------------------------------------------------------------

/** Safely read the response body text on an error response. */
const readResponseText = async (response: Response): Promise<string> => {
  try {
    const text = await response.text();
    return text.slice(0, 500);
  } catch {
    return '(unable to read response body)';
  }
};

export {
  DEFAULT_TIMEOUT_SECONDS,
  DEFAULT_CACHE_TTL_MINUTES,
  DEFAULT_MAX_CACHE_ENTRIES,
  normalizeCacheKey,
  readCache,
  writeCache,
  withTimeout,
  readResponseText,
};
export type { CacheEntry };
