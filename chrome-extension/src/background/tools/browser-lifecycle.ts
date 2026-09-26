import { registerToolCleanup } from './tool-lifecycle';

const owners = new Map<number, AbortSignal | undefined>();
const queues = new Map<number, Promise<unknown>>();

const onTab = async <T>(tabId: number, work: () => Promise<T>): Promise<T> => {
  const pending = (queues.get(tabId) ?? Promise.resolve()).catch(() => {}).then(work);
  queues.set(tabId, pending);
  try {
    return await pending;
  } finally {
    if (queues.get(tabId) === pending) queues.delete(tabId);
  }
};

export const runBrowserTabAction = <T>(
  args: { tabId?: number; action: string; ref?: number },
  signal: AbortSignal | undefined,
  execute: () => Promise<T>,
  clear: (tabId: number) => Promise<void>,
): Promise<T | string> => {
  if (signal?.aborted) return Promise.resolve('Error: Browser action was cancelled.');
  const tabId = args.tabId;
  if (tabId == null) return execute();
  return onTab(tabId, async () => {
    if (signal?.aborted) return 'Error: Browser action was cancelled.';
    if (args.action === 'snapshot') {
      owners.set(tabId, signal);
      if (signal) {
        registerToolCleanup(signal, `browser:${tabId}`, () =>
          onTab(tabId, async () => {
            if (owners.get(tabId) !== signal) return;
            owners.delete(tabId);
            await clear(tabId);
          }),
        );
      }
    } else if (signal && args.ref != null && owners.get(tabId) !== signal) {
      return 'Error: Snapshot refs belong to another or completed task. Run "snapshot" to refresh refs.';
    }
    return execute();
  });
};
