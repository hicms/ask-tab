import { createStorage, StorageEnum } from '../base/index.js';

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
}

const publicModelsStorage = createStorage<PublicModel[]>('public-models', [], {
  storageEnum: StorageEnum.Local,
  liveUpdate: true,
});

export type { PublicModel };
export { publicModelsStorage };
