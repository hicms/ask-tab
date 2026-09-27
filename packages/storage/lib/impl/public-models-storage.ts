import { createStorage, StorageEnum } from '../base/index.js';

/** Strongest first; the model picker shows its groups in this order. */
const modelTiers = ['flagship', 'balanced', 'fast'] as const;
type ModelTier = (typeof modelTiers)[number];

interface PublicModel {
  id: string;
  name: string;
  protocol: string;
  kind: 'chat' | 'stt' | 'tts' | 'embedding';
  embeddingSpaceId: string | null;
  isDefault: boolean;
  supportsTools: boolean;
  supportsReasoning: boolean;
  supportsImages: boolean;
  contextWindow: number | null;
  /** Model maker key such as `xai`; the picker maps it to an icon. */
  vendor: string | null;
  tier: ModelTier | null;
  /** Price relative to the catalog reference price, where 1 is the reference. */
  priceMultiplier: number | null;
}

const publicModelsStorage = createStorage<PublicModel[]>('public-models', [], {
  storageEnum: StorageEnum.Local,
  liveUpdate: true,
});

export type { ModelTier, PublicModel };
export { modelTiers, publicModelsStorage };
