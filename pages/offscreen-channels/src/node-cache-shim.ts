/**
 * Browser-compatible replacement for `@cacheable/node-cache`.
 *
 * Baileys creates internal caches (callOfferCache, placeholderResendCache, etc.)
 * via `new NodeCache({ stdTTL, useClones: false })`. This shim provides the
 * subset of the API Baileys actually uses — backed by a simple Map + TTL —
 * so these caches work in the Chrome extension's offscreen document without
 * pulling in the Node.js-only `@cacheable/node-cache` package.
 */

interface NodeCacheOptions {
  stdTTL?: number;
  useClones?: boolean;
}

class NodeCache {
  private store = new Map<string, { value: unknown; expiresAt: number }>();
  private readonly ttlMs: number;

  constructor(opts?: NodeCacheOptions) {
    this.ttlMs = (opts?.stdTTL ?? 0) * 1000;
  }

  get<T>(key: string): T | undefined {
    const entry = this.store.get(key);
    if (!entry) return undefined;
    if (this.ttlMs > 0 && Date.now() > entry.expiresAt) {
      this.store.delete(key);
      return undefined;
    }
    return entry.value as T;
  }

  set<T>(key: string, value: T): void {
    const expiresAt = this.ttlMs > 0 ? Date.now() + this.ttlMs : Infinity;
    this.store.set(key, { value, expiresAt });
  }

  del(key: string): void {
    this.store.delete(key);
  }

  flushAll(): void {
    this.store.clear();
  }
}

export default NodeCache;
