import { loadCachedEmbeddings, cacheEmbeddings, pruneEmbeddingCache } from './embedding-cache';
import { resolveEmbeddingProvider } from './embedding-provider';
import { chunkText } from './memory-chunker';
import { buildIndex } from './memory-search';
import { createLogger } from '../logging/logger-buffer';
import {
  listWorkspaceFiles,
  bulkPutMemoryChunks,
  deleteMemoryChunksByFileId,
  getAllMemoryChunks,
  publicModelsStorage,
  embeddingConfigStorage,
} from '@extension/storage';
import { nanoid } from 'nanoid';
import type { EmbeddingProvider } from './embedding-types';
import type { BM25Index } from './memory-search';
import type { DbMemoryChunk, DbWorkspaceFile } from '@extension/storage';

const syncLog = createLogger('memory-sync');

const EMBEDDING_BATCH_MAX_TOKENS = 8000;

/** Per-agent cache entry */
interface CacheEntry {
  index: BM25Index;
  chunks: DbMemoryChunk[];
  dirty: boolean;
  spaceId?: string;
}

const agentCaches = new Map<string, CacheEntry>();
/** Global invalidation for workspace or model changes. */
let globalDirty = true;

const invalidateMemoryIndex = (agentId?: string): void => {
  if (agentId) {
    const entry = agentCaches.get(agentId);
    if (entry) entry.dirty = true;
  } else {
    globalDirty = true;
    for (const entry of agentCaches.values()) entry.dirty = true;
  }
};

const isMemoryEligible = (file: DbWorkspaceFile): boolean =>
  file.name === 'MEMORY.md' || file.name.startsWith('memory/');

const assertEmbeddingSelection = async (provider: EmbeddingProvider): Promise<void> => {
  const [catalog, config] = await Promise.all([
    publicModelsStorage.get(),
    embeddingConfigStorage.get(),
  ]);
  const choices = catalog.filter(model => model.kind === 'embedding');
  const selected = config.openaiCompatible.modelId
    ? choices.find(model => model.id === config.openaiCompatible.modelId)
    : (choices.find(model => model.isDefault) ?? choices[0]);
  if (
    config.provider !== 'openai-compatible' ||
    selected?.id !== provider.model ||
    selected.embeddingSpaceId !== provider.spaceId
  ) {
    throw new Error('Embedding model changed during indexing');
  }
};

/**
 * Embed chunks that need (re-)embedding, using persistent cache where possible.
 * Mutates chunk objects in place with embedding data, then persists to DB.
 * Returns the (possibly re-read) chunk array.
 */
const embedChunks = async (
  chunks: DbMemoryChunk[],
  provider: EmbeddingProvider,
  agentId?: string,
): Promise<DbMemoryChunk[]> => {
  const needsEmbedding = chunks.filter(
    c =>
      !c.embedding ||
      c.embedding.length === 0 ||
      c.embeddingProvider !== provider.id ||
      c.embeddingModel !== provider.model ||
      c.embeddingSpaceId !== provider.spaceId,
  );

  if (needsEmbedding.length === 0) {
    syncLog.trace('embedChunks: all chunks up to date', { total: chunks.length });
    return chunks;
  }
  syncLog.trace('embedChunks: starting', {
    total: chunks.length,
    needsEmbedding: needsEmbedding.length,
    provider: provider.id,
    model: provider.model,
  });

  // Check cache first
  const hashes = needsEmbedding.filter(c => c.contentHash).map(c => c.contentHash!);
  const cachedEmbeddings = await loadCachedEmbeddings(provider.spaceId, hashes);

  // Apply cached embeddings
  const stillNeeded: DbMemoryChunk[] = [];
  for (const chunk of needsEmbedding) {
    const cachedVec = chunk.contentHash ? cachedEmbeddings.get(chunk.contentHash) : undefined;
    if (cachedVec) {
      chunk.embedding = cachedVec;
      chunk.embeddingProvider = provider.id;
      chunk.embeddingModel = provider.model;
      chunk.embeddingSpaceId = provider.spaceId;
    } else {
      stillNeeded.push(chunk);
    }
  }
  syncLog.trace('embedChunks: cache applied', {
    fromCache: needsEmbedding.length - stillNeeded.length,
    stillNeeded: stillNeeded.length,
  });

  // Batch embed remaining chunks
  if (stillNeeded.length > 0) {
    const batches: DbMemoryChunk[][] = [];
    let currentBatch: DbMemoryChunk[] = [];
    let currentTokens = 0;

    for (const chunk of stillNeeded) {
      const estimatedTokens = Math.ceil(chunk.text.length / 4);
      if (currentBatch.length > 0 && currentTokens + estimatedTokens > EMBEDDING_BATCH_MAX_TOKENS) {
        batches.push(currentBatch);
        currentBatch = [];
        currentTokens = 0;
      }
      currentBatch.push(chunk);
      currentTokens += estimatedTokens;
    }
    if (currentBatch.length > 0) batches.push(currentBatch);
    syncLog.trace('embedChunks: batched for API', {
      batchCount: batches.length,
      chunkCount: stillNeeded.length,
    });

    const newCacheEntries: Array<{ contentHash: string; embedding: number[]; dims: number }> = [];

    for (const batch of batches) {
      try {
        const embeddings = await provider.embedBatch(batch.map(c => c.text));
        for (let i = 0; i < batch.length; i++) {
          const vec = embeddings[i] ?? [];
          batch[i].embedding = vec;
          batch[i].embeddingProvider = provider.id;
          batch[i].embeddingModel = provider.model;
          batch[i].embeddingSpaceId = provider.spaceId;
          if (batch[i].contentHash && vec.length > 0) {
            newCacheEntries.push({
              contentHash: batch[i].contentHash!,
              embedding: vec,
              dims: vec.length,
            });
          }
        }
      } catch (err) {
        syncLog.warn('Embedding batch failed, continuing with BM25-only', {
          error: err instanceof Error ? err.message : String(err),
        });
        break; // Stop trying if provider is down
      }
    }

    if (newCacheEntries.length > 0) {
      await assertEmbeddingSelection(provider);
      await cacheEmbeddings(provider, newCacheEntries).catch(() => {});
    }
  }

  // Persist all updated chunks (including those from cache)
  const updated = needsEmbedding.filter(c => c.embedding && c.embedding.length > 0);
  if (updated.length > 0) {
    await assertEmbeddingSelection(provider);
    await bulkPutMemoryChunks(updated);
    syncLog.trace('embedChunks: persisted', { updatedCount: updated.length });
    return getAllMemoryChunks(agentId);
  }

  return chunks;
};

const syncMemoryIndex = async (
  agentId?: string,
): Promise<{ index: BM25Index; chunks: DbMemoryChunk[] }> => {
  const cacheKey = agentId ?? '__global__';
  const cached = agentCaches.get(cacheKey);
  const catalog = await publicModelsStorage.get();
  const embeddingConfig = await embeddingConfigStorage.get();
  const embeddingModels = catalog.filter(model => model.kind === 'embedding');
  const configuredSpace =
    embeddingConfig.provider === 'openai-compatible'
      ? (embeddingConfig.openaiCompatible.modelId
          ? embeddingModels.find(model => model.id === embeddingConfig.openaiCompatible.modelId)
          : (embeddingModels.find(model => model.isDefault) ?? embeddingModels[0])
        )?.embeddingSpaceId
      : undefined;
  const isDirty = cached ? cached.dirty || globalDirty || cached.spaceId !== configuredSpace : true;

  if (cached && !isDirty) {
    // Check staleness: compare file versions
    const files = await listWorkspaceFiles(agentId);
    const memFiles = files.filter(isMemoryEligible);
    let stale = false;

    for (const file of memFiles) {
      const cachedVersion = cached.index.fileVersions.get(file.id);
      if (cachedVersion === undefined || cachedVersion !== file.updatedAt) {
        stale = true;
        break;
      }
    }

    // Check for deleted files
    if (!stale) {
      const currentFileIds = new Set(memFiles.map(f => f.id));
      for (const fileId of cached.index.fileVersions.keys()) {
        if (!fileId.startsWith('transcript:') && !currentFileIds.has(fileId)) {
          stale = true;
          break;
        }
      }
    }

    if (!stale) return { index: cached.index, chunks: cached.chunks };
  }

  // Full re-sync
  const files = await listWorkspaceFiles(agentId);
  const memFiles = files.filter(isMemoryEligible);
  const existingChunks = await getAllMemoryChunks(agentId);

  // Group existing chunks by fileId
  const chunksByFile = new Map<string, DbMemoryChunk[]>();
  for (const chunk of existingChunks) {
    let arr = chunksByFile.get(chunk.fileId);
    if (!arr) {
      arr = [];
      chunksByFile.set(chunk.fileId, arr);
    }
    arr.push(chunk);
  }

  const currentFileIds = new Set(memFiles.map(f => f.id));

  // Delete chunks for files that no longer exist
  for (const fileId of chunksByFile.keys()) {
    if (!fileId.startsWith('transcript:') && !currentFileIds.has(fileId)) {
      await deleteMemoryChunksByFileId(fileId);
    }
  }

  // Re-chunk changed/new files
  for (const file of memFiles) {
    const existingFileChunks = chunksByFile.get(file.id);
    const isUpToDate =
      existingFileChunks &&
      existingFileChunks.length > 0 &&
      existingFileChunks[0].fileUpdatedAt === file.updatedAt;

    if (isUpToDate) continue;

    // Delete old chunks for this file
    await deleteMemoryChunksByFileId(file.id);

    // Skip empty files
    if (!file.content) continue;

    // Create new chunks
    const memChunks = await chunkText(file.content);
    const dbChunks: DbMemoryChunk[] = memChunks.map(mc => ({
      id: nanoid(),
      fileId: file.id,
      filePath: file.name,
      startLine: mc.startLine,
      endLine: mc.endLine,
      text: mc.text,
      contentHash: mc.contentHash,
      fileUpdatedAt: file.updatedAt,
      agentId,
    }));

    if (dbChunks.length > 0) {
      await bulkPutMemoryChunks(dbChunks);
    }
  }

  // Rebuild index from all chunks
  let allChunks = await getAllMemoryChunks(agentId);
  const newIndex = buildIndex(allChunks);

  // ── Embedding pass (non-fatal) ──
  const provider = await resolveEmbeddingProvider();
  if (provider) {
    try {
      allChunks = await embedChunks(allChunks, provider, agentId);
      await pruneEmbeddingCache().catch(() => {});
    } catch (err) {
      syncLog.warn('Embedding pass failed', { error: String(err) });
    }
  }

  agentCaches.set(cacheKey, {
    index: newIndex,
    chunks: allChunks,
    dirty: false,
    spaceId: provider?.spaceId,
  });
  return { index: newIndex, chunks: allChunks };
};

// For testing
const _resetCache = (): void => {
  agentCaches.clear();
  globalDirty = true;
};

export { invalidateMemoryIndex, syncMemoryIndex, isMemoryEligible, _resetCache };
