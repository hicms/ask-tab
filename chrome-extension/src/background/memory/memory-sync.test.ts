import { _resetCache, invalidateMemoryIndex, syncMemoryIndex } from './memory-sync';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { DbMemoryChunk } from '@extension/storage';

const { chunks, deleteChunk } = vi.hoisted(() => {
  const chunks: DbMemoryChunk[] = [];
  const deleteChunk = vi.fn(async (fileId: string) => {
    for (let i = chunks.length - 1; i >= 0; i--)
      if (chunks[i]?.fileId === fileId) chunks.splice(i, 1);
  });
  return { chunks, deleteChunk };
});

vi.mock('@extension/storage', () => ({
  listWorkspaceFiles: vi.fn(async () => []),
  getAllMemoryChunks: vi.fn(async () => [...chunks]),
  deleteMemoryChunksByFileId: deleteChunk,
  bulkPutMemoryChunks: vi.fn(async () => {}),
  publicModelsStorage: { get: vi.fn(async () => []) },
  embeddingConfigStorage: {
    get: vi.fn(async () => ({ provider: 'none', openaiCompatible: { modelId: '' } })),
  },
}));
vi.mock('./embedding-provider', () => ({ resolveEmbeddingProvider: vi.fn(async () => null) }));
vi.mock('../logging/logger-buffer', () => ({
  createLogger: () => ({ trace: vi.fn(), warn: vi.fn() }),
}));

describe('memory sync', () => {
  beforeEach(() => {
    chunks.length = 0;
    deleteChunk.mockClear();
    _resetCache();
  });

  it('preserves transcript chunks when workspace files are synchronized again', async () => {
    chunks.push({
      id: 'transcript-1',
      fileId: 'transcript:chat-1',
      filePath: 'transcript/chat-1',
      startLine: 1,
      endLine: 1,
      text: 'remember this',
      fileUpdatedAt: 1,
    });
    await syncMemoryIndex();
    invalidateMemoryIndex();
    const result = await syncMemoryIndex();
    expect(result.chunks.map(chunk => chunk.id)).toContain('transcript-1');
    expect(deleteChunk).not.toHaveBeenCalledWith('transcript:chat-1');
  });
});
