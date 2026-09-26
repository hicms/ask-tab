import { createRemoteEmbeddingProvider } from './embedding-remote';
import { requireSession } from '../ask-service/client';
import { createLogger } from '../logging/logger-buffer';
import { embeddingConfigStorage, publicModelsStorage } from '@extension/storage';
import type { EmbeddingProvider } from './embedding-types';

const embLog = createLogger('embedding');

const resolveEmbeddingProvider = async (): Promise<EmbeddingProvider | null> => {
  const config = await embeddingConfigStorage.get();
  if (config.provider === 'none') return null;
  if (config.provider === 'local') {
    embLog.warn('Local embedding provider is not configured; using BM25 search');
    return null;
  }
  const models = (await publicModelsStorage.get()).filter(model => model.kind === 'embedding');
  const selected = config.openaiCompatible.modelId
    ? models.find(model => model.id === config.openaiCompatible.modelId)
    : (models.find(model => model.isDefault) ?? models[0]);
  if (!selected?.embeddingSpaceId) {
    embLog.warn('Server embedding is not configured; using BM25 search');
    return null;
  }
  const session = await requireSession();
  return createRemoteEmbeddingProvider({
    modelId: selected.id,
    spaceId: selected.embeddingSpaceId,
    session,
  });
};

export { resolveEmbeddingProvider };
