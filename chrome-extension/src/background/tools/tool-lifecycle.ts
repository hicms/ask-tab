import { createLogger } from '../logging/logger-buffer';

const resources = new WeakMap<AbortSignal, Map<unknown, () => Promise<void>>>();
const log = createLogger('tool');

/** The execution signal identifies one agent run, including tools supplied by a caller. */
export const registerToolCleanup = (
  signal: AbortSignal,
  key: unknown,
  cleanup: () => Promise<void>,
): void => {
  let callbacks = resources.get(signal);
  if (!callbacks) resources.set(signal, (callbacks = new Map()));
  callbacks.set(key, cleanup);
};

export const releaseToolResources = async (signal: AbortSignal): Promise<void> => {
  const callbacks = resources.get(signal);
  resources.delete(signal);
  const results = await Promise.allSettled(
    [...(callbacks?.values() ?? [])].map(cleanup => Promise.resolve().then(cleanup)),
  );
  for (const result of results) {
    if (result.status === 'rejected') {
      log.warn('Tool cleanup failed', { error: String(result.reason) });
    }
  }
};
