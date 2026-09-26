import { createStorage, StorageEnum } from '../base/index.js';

interface AskSession {
  token: string;
  userId: string;
  email: string;
  expiresAt: number;
}

/** Signed-in ask_service account. Deliberately outside the full-backup key set. */
const askSessionStorage = createStorage<AskSession | null>('ask-session', null, {
  storageEnum: StorageEnum.Local,
  liveUpdate: true,
});

export type { AskSession };
export { askSessionStorage };
