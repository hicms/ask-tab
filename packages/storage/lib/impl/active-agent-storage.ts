import { createStorage, StorageEnum } from '../base/index.js';

export const activeAgentStorage = createStorage<string>('active-agent-id', 'main', {
  storageEnum: StorageEnum.Local,
  liveUpdate: true,
});
