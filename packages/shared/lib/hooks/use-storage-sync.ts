import { useState, useEffect } from 'react';
import type { Dispatch, SetStateAction } from 'react';

interface SyncableStorage<T> {
  get: () => Promise<T>;
  subscribe: (listener: () => void) => () => void;
}

/**
 * Keeps React state in sync with a chrome storage instance.
 * Loads the initial value on mount, then subscribes to live updates.
 */
const useStorageSync = <T>(
  storage: SyncableStorage<T>,
): [T | null, Dispatch<SetStateAction<T | null>>] => {
  const [value, setValue] = useState<T | null>(null);

  useEffect(() => {
    storage.get().then(setValue);
    const unsub = storage.subscribe(() => {
      storage.get().then(setValue);
    });
    return unsub;
  }, [storage]);

  return [value, setValue];
};

export { useStorageSync };
