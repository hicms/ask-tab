// ──────────────────────────────────────────────
// WhatsApp Auth State — Chrome Storage Backend
// ──────────────────────────────────────────────
// Replaces Baileys' useMultiFileAuthState (which uses Node.js fs)
// with chrome.storage.local for credential persistence (via storage proxy).
//
// Uses BufferJSON from Baileys for safe Buffer serialization.

import { storageProxy } from './storage-proxy';
import { BufferJSON, initAuthCreds, proto } from '@extension/baileys';
import { diagnostics } from '@extension/shared/lib/diagnostics.js';
import type {
  AuthenticationCreds,
  AuthenticationState,
  SignalDataTypeMap,
} from '@extension/baileys';

const CREDS_KEY = 'wa-auth-creds';
const KEYS_PREFIX = 'wa-auth-keys';

/**
 * In-memory cache for Signal protocol keys.
 * Ensures read-after-write consistency: when Baileys rotates a ratchet key
 * via set() then immediately reads it via get(), the read returns the new
 * value even if the async storage write hasn't completed yet.
 * A value of `null` is a deletion sentinel — prevents re-fetching deleted keys
 * from storage.
 */
const keyCache = new Map<string, unknown>();

/** Build a storage key for a signal key */
const keyStorageKey = (type: string, id: string): string => `${KEYS_PREFIX}:${type}:${id}`;

/** Simple mutex for serializing concurrent writes */
let writeLock: Promise<void> = Promise.resolve();
const withLock = async <T>(fn: () => Promise<T>): Promise<T> => {
  const prev = writeLock;
  let release: () => void;
  writeLock = new Promise<void>(resolve => {
    release = resolve;
  });
  try {
    await prev;
    return await fn();
  } finally {
    release!();
  }
};

/**
 * Chrome storage-backed auth state for Baileys.
 * Same interface as Baileys' useMultiFileAuthState.
 */
const useChromeStorageAuthState = async (): Promise<{
  state: AuthenticationState;
  saveCreds: () => Promise<void>;
}> => {
  // Load existing creds or initialize fresh
  const data = await storageProxy.get(CREDS_KEY);
  let creds: AuthenticationCreds;

  if (data[CREDS_KEY]) {
    try {
      creds = JSON.parse(data[CREDS_KEY] as string, BufferJSON.reviver);
    } catch {
      diagnostics.warn('[wa-auth] Failed to parse saved creds, initializing fresh');
      creds = initAuthCreds();
    }
  } else {
    creds = initAuthCreds();
  }

  return {
    state: {
      creds,
      keys: {
        get: async <T extends keyof SignalDataTypeMap>(
          type: T,
          ids: string[],
        ): Promise<Record<string, SignalDataTypeMap[T]>> => {
          const result: Record<string, SignalDataTypeMap[T]> = {};
          const missIds: string[] = [];
          const missKeys: string[] = [];

          // Check cache first — cache hits skip storage entirely
          for (const id of ids) {
            const key = keyStorageKey(type, id);
            if (keyCache.has(key)) {
              const cached = keyCache.get(key);
              // null is a deletion sentinel — treat as "not found"
              if (cached !== null) {
                result[id] = cached as SignalDataTypeMap[T];
              }
            } else {
              missIds.push(id);
              missKeys.push(key);
            }
          }

          // Fetch cache misses from storage
          let storageMisses = 0;
          if (missKeys.length > 0) {
            const stored = await storageProxy.get(missKeys);

            for (const id of missIds) {
              const key = keyStorageKey(type, id);
              const value = stored[key];
              if (value) {
                try {
                  let parsed = JSON.parse(value as string, BufferJSON.reviver);
                  if (type === 'app-state-sync-key' && parsed) {
                    parsed = proto.Message.AppStateSyncKeyData.fromObject(parsed);
                  }
                  result[id] = parsed;
                  keyCache.set(key, parsed);
                } catch {
                  // Skip corrupted entries
                  storageMisses++;
                }
              } else {
                storageMisses++;
              }
            }
          }

          diagnostics.info('[wa-auth] keys.get', {
            type,
            requested: ids.length,
            cacheHits: ids.length - missKeys.length,
            storageMisses,
            returned: Object.keys(result).length,
          });

          return result;
        },

        set: async (data: Record<string, Record<string, unknown>>): Promise<void> => {
          // Log key types and counts for diagnostics
          const typeCounts: Record<string, number> = {};
          for (const type in data) {
            typeCounts[type] = Object.keys(data[type]).length;
          }
          diagnostics.info('[wa-auth] keys.set', typeCounts);

          // Update cache synchronously BEFORE async storage write.
          // This is the critical fix: ensures read-after-write consistency
          // so Baileys' Signal ratchet keys are immediately visible to get().
          const toStore: Record<string, string> = {};
          const toRemove: string[] = [];

          for (const type in data) {
            for (const id in data[type]) {
              const key = keyStorageKey(type, id);
              const value = data[type][id];
              if (value) {
                keyCache.set(key, value);
                toStore[key] = JSON.stringify(value, BufferJSON.replacer);
              } else {
                keyCache.set(key, null); // deletion sentinel
                toRemove.push(key);
              }
            }
          }

          await withLock(async () => {
            if (Object.keys(toStore).length > 0) {
              await storageProxy.set(toStore);
            }
            if (toRemove.length > 0) {
              await storageProxy.remove(toRemove);
            }
          });
        },
      },
    },

    saveCreds: async (): Promise<void> => {
      await withLock(async () => {
        await storageProxy.set({
          [CREDS_KEY]: JSON.stringify(creds, BufferJSON.replacer),
        });
      });
    },
  };
};

export { useChromeStorageAuthState, CREDS_KEY, KEYS_PREFIX, keyCache };
