import { createStorage, StorageEnum } from '../base/index.js';
import type { ReasoningValue } from './public-models-storage.js';

/** Public model ID → control path → the value the user picked. */
type ReasoningSelections = Record<string, Record<string, ReasoningValue>>;

const reasoningSelectionsStorage = createStorage<ReasoningSelections>(
  'reasoning-selections',
  {},
  {
    storageEnum: StorageEnum.Local,
    liveUpdate: true,
  },
);

export type { ReasoningSelections };
export { reasoningSelectionsStorage };
