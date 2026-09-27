import type { ChatModel, ModelProvider } from './chat-types.js';
import type { DbChatModel } from '@extension/storage';

/** Chat pages select by storage ID and send `modelId` to the provider. */
const chatModelFromStored = (stored: DbChatModel): ChatModel => ({
  id: stored.modelId || stored.id,
  dbId: stored.id,
  name: stored.name,
  provider: stored.provider as ModelProvider,
  description: stored.description,
  supportsTools: stored.supportsTools,
  supportsReasoning: stored.supportsReasoning,
  supportsImages: stored.supportsImages,
  toolTimeoutSeconds: stored.toolTimeoutSeconds,
  contextWindow: stored.contextWindow,
  vendor: stored.vendor,
  tier: stored.tier,
  priceMultiplier: stored.priceMultiplier,
});

export { chatModelFromStored };
