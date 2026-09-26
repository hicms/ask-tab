import { createStorage, StorageEnum } from '../base/index.js';

export const selectedModelStorage = createStorage<string>('selected-model-id', '', {
  storageEnum: StorageEnum.Local,
  liveUpdate: true,
});
