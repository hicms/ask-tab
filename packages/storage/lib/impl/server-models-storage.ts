import { createStorage, StorageEnum } from '../base/index.js';
import type { DbChatModel } from './chat-db.js';

export const serverModelsStorage = createStorage<DbChatModel[]>('server-models', [], {
  storageEnum: StorageEnum.Local,
  liveUpdate: true,
});
