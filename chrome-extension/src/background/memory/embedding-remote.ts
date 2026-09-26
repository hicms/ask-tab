import { sanitizeAndNormalizeEmbedding } from './embedding-normalize';
import { requestAuthorized, requireSession } from '../ask-service/client';
import { embeddingConfigStorage, publicModelsStorage } from '@extension/storage';
import type { EmbeddingProvider } from './embedding-types';
import type { AskSession } from '@extension/storage';

interface RemoteEmbeddingOptions {
  modelId: string;
  spaceId: string;
  session: AskSession;
}

const createRemoteEmbeddingProvider = (options: RemoteEmbeddingOptions): EmbeddingProvider => {
  const assertCurrent = async (): Promise<void> => {
    await requireSession(options.session);
    const models = await publicModelsStorage.get();
    const embeddingModels = models.filter(model => model.kind === 'embedding');
    const config = await embeddingConfigStorage.get();
    const selected = config.openaiCompatible.modelId
      ? embeddingModels.find(model => model.id === config.openaiCompatible.modelId)
      : (embeddingModels.find(model => model.isDefault) ?? embeddingModels[0]);
    if (
      config.provider !== 'openai-compatible' ||
      selected?.id !== options.modelId ||
      selected.embeddingSpaceId !== options.spaceId
    ) {
      throw new Error('Embedding model changed during request');
    }
  };

  const embedBatch = async (input: string[]): Promise<number[][]> => {
    if (input.length === 0) return [];
    await assertCurrent();
    const response = await requestAuthorized(
      `/api/embeddings/${encodeURIComponent(options.modelId)}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ input }),
        signal: AbortSignal.timeout(60_000),
      },
      options.session,
    );
    const payload = (await response.json()) as {
      data?: Array<{ index: number; embedding: number[] }>;
    };
    await assertCurrent();
    const data = payload.data;
    if (!Array.isArray(data) || data.length !== input.length) {
      throw new Error('Invalid server embedding response');
    }
    const vectors = [...data].sort((a, b) => a.index - b.index).map(item => item.embedding);
    if (
      vectors.some(
        (vector, index) => data.every(item => item.index !== index) || !Array.isArray(vector),
      )
    ) {
      throw new Error('Invalid server embedding response');
    }
    return vectors.map(sanitizeAndNormalizeEmbedding);
  };

  return {
    id: 'server',
    model: options.modelId,
    spaceId: options.spaceId,
    embedQuery: async (text: string) => (await embedBatch([text]))[0] ?? [],
    embedBatch,
  };
};

export { createRemoteEmbeddingProvider };
export type { RemoteEmbeddingOptions };
