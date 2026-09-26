import { diagnostics } from '@extension/shared/lib/diagnostics.js';
// ──────────────────────────────────────────────
// Storage Proxy — Routes chrome.storage.local ops to Service Worker
// ──────────────────────────────────────────────
// Chrome MV3 offscreen documents do NOT have access to chrome.storage.
// This thin proxy sends typed messages to the service worker (which has
// full chrome.storage.local access) via chrome.runtime.sendMessage.

interface StorageProxy {
  get(keys: string | string[]): Promise<Record<string, unknown>>;
  set(items: Record<string, unknown>): Promise<void>;
  remove(keys: string | string[]): Promise<void>;
}

const MAX_RETRIES = 3;
const BASE_DELAY_MS = 200;

/**
 * Retry wrapper with exponential backoff.
 * Retries on `undefined`/`null` responses (SW suspended/restarting)
 * and on sendMessage rejections (SW crashed).
 */
const withRetry = async <T>(
  fn: () => Promise<T>,
  validate: (result: T) => boolean,
  label: string,
): Promise<T> => {
  const t0 = Date.now();
  for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
    try {
      const result = await fn();
      if (validate(result)) {
        if (attempt > 1) {
          diagnostics.info(`[storage-proxy] ${label} OK after retry`, {
            attempt,
            elapsedMs: Date.now() - t0,
          });
        }
        return result;
      }
      // Response was undefined/null — SW didn't respond
      diagnostics.warn(`[storage-proxy] ${label} got empty response`, {
        attempt,
        maxRetries: MAX_RETRIES,
      });
      if (attempt < MAX_RETRIES) {
        await delay(BASE_DELAY_MS * Math.pow(2, attempt - 1));
        continue;
      }
      throw new Error('Storage proxy: service worker did not respond after retries');
    } catch (err) {
      diagnostics.warn(`[storage-proxy] ${label} attempt ${attempt} failed`, {
        error: err instanceof Error ? err.message : String(err),
        elapsedMs: Date.now() - t0,
      });
      if (attempt >= MAX_RETRIES) throw err;
      await delay(BASE_DELAY_MS * Math.pow(2, attempt - 1));
    }
  }
  // Unreachable, but satisfies TypeScript
  throw new Error('Storage proxy: retries exhausted');
};

const delay = (ms: number): Promise<void> => new Promise(resolve => setTimeout(resolve, ms));

/** Check that a sendMessage response is a real object (not undefined/null) */
const isValidResponse = (response: unknown): boolean =>
  response !== undefined && response !== null && typeof response === 'object';

interface StorageResponse {
  data?: Record<string, unknown>;
  error?: string;
  success?: boolean;
}

const storageProxy: StorageProxy = {
  async get(keys) {
    const keyList = typeof keys === 'string' ? [keys] : keys;
    const label = `get(${keyList.length} key${keyList.length !== 1 ? 's' : ''}: ${keyList.slice(0, 3).join(', ')}${keyList.length > 3 ? '...' : ''})`;
    diagnostics.debug(`[storage-proxy] ${label} START`);
    const t0 = Date.now();

    const response = await withRetry<StorageResponse>(
      () => chrome.runtime.sendMessage({ type: 'OFFSCREEN_STORAGE_GET', keys }),
      isValidResponse,
      label,
    );
    if (response?.error) {
      throw new Error(response.error);
    }
    diagnostics.debug(`[storage-proxy] ${label} OK`, { elapsedMs: Date.now() - t0 });
    return (response?.data ?? {}) as Record<string, unknown>;
  },

  async set(items) {
    const keyList = Object.keys(items);
    const label = `set(${keyList.length} key${keyList.length !== 1 ? 's' : ''}: ${keyList.slice(0, 3).join(', ')}${keyList.length > 3 ? '...' : ''})`;
    diagnostics.debug(`[storage-proxy] ${label} START`);
    const t0 = Date.now();

    const response = await withRetry<StorageResponse>(
      () => chrome.runtime.sendMessage({ type: 'OFFSCREEN_STORAGE_SET', items }),
      isValidResponse,
      label,
    );
    if (response?.error) {
      throw new Error(response.error);
    }
    diagnostics.debug(`[storage-proxy] ${label} OK`, { elapsedMs: Date.now() - t0 });
  },

  async remove(keys) {
    const keyList = typeof keys === 'string' ? [keys] : keys;
    const label = `remove(${keyList.length} key${keyList.length !== 1 ? 's' : ''}: ${keyList.slice(0, 3).join(', ')}${keyList.length > 3 ? '...' : ''})`;
    diagnostics.debug(`[storage-proxy] ${label} START`);
    const t0 = Date.now();

    const response = await withRetry<StorageResponse>(
      () => chrome.runtime.sendMessage({ type: 'OFFSCREEN_STORAGE_REMOVE', keys }),
      isValidResponse,
      label,
    );
    if (response?.error) {
      throw new Error(response.error);
    }
    diagnostics.debug(`[storage-proxy] ${label} OK`, { elapsedMs: Date.now() - t0 });
  },
};

export { storageProxy };
export type { StorageProxy };
