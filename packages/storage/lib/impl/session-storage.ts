import { createStorage, StorageEnum } from '../base/index.js';

export const lastActiveSessionStorage = createStorage<string>('last-active-session-id', '', {
  storageEnum: StorageEnum.Local,
  liveUpdate: true,
});
