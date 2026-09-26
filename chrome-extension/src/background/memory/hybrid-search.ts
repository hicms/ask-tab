/**
 * Hybrid search: combines BM25 keyword scores + vector cosine similarity.
 * Falls back to pure BM25 when no embedding provider is configured.
 *
 */
import { cosineSimilarity } from './cosine-similarity';
import { resolveEmbeddingProvider } from './embedding-provider';
import { search as bm25Search } from './memory-search';
import { mmrRerank } from './mmr';
import { applyTemporalDecay } from './temporal-decay';
import { createLogger } from '../logging/logger-buffer';
import { embeddingConfigStorage } from '@extension/storage';
import type { BM25Index, SearchResult } from './memory-search';
import type { DbMemoryChunk } from '@extension/storage';

const searchLog = createLogger('embedding');

interface HybridSearchOptions {
  maxResults?: number;
  minScore?: number;
}

interface HybridSearchResult extends SearchResult {
  bm25Score: number;
  vectorScore: number;
}

const hybridSearch = async (
  index: BM25Index,
  query: string,
  chunks: DbMemoryChunk[],
  options?: HybridSearchOptions,
): Promise<HybridSearchResult[]> => {
  const maxResults = options?.maxResults ?? 10;
  const minScore = options?.minScore ?? 0.0;
  const provider = await resolveEmbeddingProvider();

  const config = await embeddingConfigStorage.get();

  // ── No embedding provider → pure BM25 (current behavior) ──
  const bm25Only = (): HybridSearchResult[] => {
    const bm25Results = bm25Search(index, query, {
      maxResults: maxResults * (config.search.candidateMultiplier || 4),
      minScore,
    });
    let mapped: HybridSearchResult[] = bm25Results.map(r => ({
      ...r,
      bm25Score: r.score,
      vectorScore: 0,
    }));

    // Build fileUpdatedAt map from chunks for temporal decay fallback
    const fileUpdatedAtMap = new Map<string, number>();
    for (const c of chunks) {
      const existing = fileUpdatedAtMap.get(c.filePath);
      if (!existing || c.fileUpdatedAt > existing) {
        fileUpdatedAtMap.set(c.filePath, c.fileUpdatedAt);
      }
    }

    // Apply temporal decay → re-sort → MMR → slice
    mapped = applyTemporalDecay(mapped, config.temporalDecay, fileUpdatedAtMap);
    mapped.sort((a, b) => b.score - a.score);
    mapped = mmrRerank(
      mapped.map(r => ({ ...r, text: r.snippet })),
      config.mmr,
    ).map(({ text: _, ...r }) => r) as HybridSearchResult[];
    mapped = mapped.slice(0, maxResults);

    searchLog.trace('hybridSearch: BM25-only', {
      query: query.slice(0, 80),
      bm25Candidates: bm25Results.length,
      temporalDecay: {
        enabled: config.temporalDecay?.enabled,
        halfLifeDays: config.temporalDecay?.halfLifeDays,
      },
      mmr: { enabled: config.mmr?.enabled, lambda: config.mmr?.lambda },
      returned: mapped.length,
      topScore: mapped[0]?.score.toFixed(3),
    });
    return mapped;
  };
  if (!provider) return bm25Only();

  const { vectorWeight, bm25Weight, candidateMultiplier } = config.search;

  // Normalize weights so they sum to 1.0
  const weightSum = vectorWeight + bm25Weight;
  const normVectorWeight = weightSum > 0 ? vectorWeight / weightSum : 0.5;
  const normBm25Weight = weightSum > 0 ? bm25Weight / weightSum : 0.5;

  const candidateCount = Math.max(1, maxResults * candidateMultiplier);

  // ── Pre-build lookup maps for O(1) chunk access ──
  const chunkById = new Map<string, DbMemoryChunk>();
  const chunkByPosition = new Map<string, DbMemoryChunk>();
  for (const c of chunks) {
    chunkById.set(c.id, c);
    chunkByPosition.set(`${c.filePath}:${c.startLine}:${c.endLine}`, c);
  }

  // ── 1. BM25 candidates ──
  const bm25Results = bm25Search(index, query, { maxResults: candidateCount, minScore: 0 });

  // ── 2. Vector candidates ──
  let queryEmbedding: number[];
  try {
    queryEmbedding = await provider.embedQuery(query);
    if (queryEmbedding.length === 0) return bm25Only();
  } catch {
    return bm25Only();
  }
  const chunksWithEmbeddings = chunks.filter(
    c =>
      c.embeddingSpaceId === provider.spaceId &&
      c.embedding?.length === queryEmbedding.length &&
      c.embedding.every(Number.isFinite),
  );

  // Brute-force cosine similarity against all embedded chunks
  const vectorScored = chunksWithEmbeddings.map(c => ({
    chunk: c,
    score: cosineSimilarity(queryEmbedding, c.embedding!),
  }));

  // ── 3. Normalize BM25 scores to [0,1] ──
  // (Vector scores from cosine of L2-normalized vectors are already in [0,1])
  const maxBm25 = bm25Results.reduce((max, r) => Math.max(max, r.score), 0);

  // ── 4. Build score lookup maps ──
  const bm25ByChunkId = new Map<string, number>();
  for (const r of bm25Results) {
    const chunk = chunkByPosition.get(`${r.path}:${r.startLine}:${r.endLine}`);
    if (chunk) {
      bm25ByChunkId.set(chunk.id, maxBm25 > 0 ? r.score / maxBm25 : 0);
    }
  }

  const vectorByChunkId = new Map<string, number>();
  for (const { chunk, score } of vectorScored) {
    vectorByChunkId.set(chunk.id, score);
  }

  // ── 5. Merge — union of all candidate chunk IDs ──
  const allIds = new Set([...bm25ByChunkId.keys(), ...vectorByChunkId.keys()]);
  const merged: HybridSearchResult[] = [];

  for (const chunkId of allIds) {
    const bm25Score = bm25ByChunkId.get(chunkId) ?? 0;
    const vectorScore = vectorByChunkId.get(chunkId) ?? 0;
    const score = normVectorWeight * vectorScore + normBm25Weight * bm25Score;

    if (score < minScore) continue;

    const chunk = chunkById.get(chunkId);
    if (!chunk) continue;

    merged.push({
      path: chunk.filePath,
      startLine: chunk.startLine,
      endLine: chunk.endLine,
      score,
      snippet: chunk.text.slice(0, 700),
      citation: `${chunk.filePath}#L${chunk.startLine}-L${chunk.endLine}`,
      bm25Score,
      vectorScore,
    });
  }

  // ── 6. Temporal decay → re-sort → MMR → slice ──
  // Build fileUpdatedAt map from chunks for temporal decay fallback
  const fileUpdatedAtMap = new Map<string, number>();
  for (const c of chunks) {
    const existing = fileUpdatedAtMap.get(c.filePath);
    if (!existing || c.fileUpdatedAt > existing) {
      fileUpdatedAtMap.set(c.filePath, c.fileUpdatedAt);
    }
  }

  const decayed = applyTemporalDecay(merged, config.temporalDecay, fileUpdatedAtMap);
  decayed.sort((a, b) => b.score - a.score);
  const reranked = mmrRerank(
    decayed.map(r => ({ ...r, text: r.snippet })),
    config.mmr,
  ).map(({ text: _, ...r }) => r) as HybridSearchResult[];
  const final = reranked.slice(0, maxResults);

  searchLog.trace('hybridSearch: merged results', {
    query: query.slice(0, 80),
    bm25Candidates: bm25Results.length,
    vectorCandidates: chunksWithEmbeddings.length,
    merged: allIds.size,
    temporalDecay: {
      enabled: config.temporalDecay?.enabled,
      halfLifeDays: config.temporalDecay?.halfLifeDays,
    },
    mmr: { enabled: config.mmr?.enabled, lambda: config.mmr?.lambda },
    returned: final.length,
    topScore: final[0]?.score.toFixed(3),
    weights: { vector: normVectorWeight.toFixed(2), bm25: normBm25Weight.toFixed(2) },
  });
  return final;
};

export { hybridSearch };
export type { HybridSearchResult, HybridSearchOptions };
