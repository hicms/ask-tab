import { createLogger } from '../logging/logger-buffer';
import { chatDb } from '@extension/storage';
import type { EmbeddingProvider } from './embedding-types';
import type { DbEmbeddingCache } from '@extension/storage';

const cacheLog = createLogger('embedding');
const MAX_CACHE_ENTRIES = 2000;
const makeCacheId = (spaceId: string, contentHash: string): string => `${spaceId}:${contentHash}`;

const loadCachedEmbeddings = async (
  spaceId: string,
  hashes: string[],
): Promise<Map<string, number[]>> => {
  const result = new Map<string, number[]>();
  if (hashes.length === 0) return result;
  const entries = await chatDb.embeddingCache
    .where('id')
    .anyOf(hashes.map(hash => makeCacheId(spaceId, hash)))
    .toArray();
  for (const entry of entries) {
    if (
      entry.embeddingSpaceId === spaceId &&
      entry.dims > 0 &&
      entry.embedding.length === entry.dims &&
      entry.embedding.every(Number.isFinite)
    ) {
      result.set(entry.contentHash, entry.embedding);
    }
  }
  if (entries.length > 0) {
    chatDb.embeddingCache
      .where('id')
      .anyOf(entries.map(entry => entry.id))
      .modify({ updatedAt: Date.now() })
      .catch(() => {});
  }
  cacheLog.trace('Cache lookup', { requested: hashes.length, hits: result.size });
  return result;
};

const cacheEmbeddings = async (
  provider: EmbeddingProvider,
  entries: Array<{ contentHash: string; embedding: number[]; dims: number }>,
): Promise<void> => {
  if (entries.length === 0) return;
  const now = Date.now();
  const records: DbEmbeddingCache[] = entries.map(entry => ({
    id: makeCacheId(provider.spaceId, entry.contentHash),
    provider: provider.id,
    model: provider.model,
    embeddingSpaceId: provider.spaceId,
    contentHash: entry.contentHash,
    embedding: entry.embedding,
    dims: entry.dims,
    updatedAt: now,
  }));
  await chatDb.embeddingCache.bulkPut(records);
};

const pruneEmbeddingCache = async (maxEntries: number = MAX_CACHE_ENTRIES): Promise<void> => {
  const count = await chatDb.embeddingCache.count();
  if (count <= maxEntries) return;
  const oldest = await chatDb.embeddingCache
    .orderBy('updatedAt')
    .limit(count - maxEntries)
    .primaryKeys();
  await chatDb.embeddingCache.bulkDelete(oldest);
};

export { loadCachedEmbeddings, cacheEmbeddings, pruneEmbeddingCache };
