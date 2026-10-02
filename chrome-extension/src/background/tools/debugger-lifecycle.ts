import { registerToolCleanup } from './tool-lifecycle';

interface DebuggerSession {
  owners: Map<AbortSignal, Set<Promise<unknown>>>;
  detaching?: Promise<void>;
  onDetach?: () => void;
}

const sessions = new Map<string, DebuggerSession>();

/** Keep a shared debugger connected until every task using it has finished. */
export const withDebuggerSession = async <T>(
  target: number | chrome.debugger.Debuggee,
  signal: AbortSignal | undefined,
  execute: () => Promise<T>,
  onDetach?: () => void,
): Promise<T> => {
  if (!signal) return execute();
  signal.throwIfAborted();
  const debuggee = typeof target === 'number' ? { tabId: target } : target;
  const key =
    debuggee.tabId != null
      ? `tab:${debuggee.tabId}`
      : debuggee.targetId != null
        ? `target:${debuggee.targetId}`
        : `extension:${debuggee.extensionId}`;

  // A new task must not attach while the previous task is still detaching.
  while (sessions.get(key)?.detaching) {
    await sessions.get(key)!.detaching;
    signal.throwIfAborted();
  }
  let session = sessions.get(key);
  if (!session) sessions.set(key, (session = { owners: new Map() }));
  if (onDetach) session.onDetach = onDetach;
  const current = session;
  let pending = current.owners.get(signal);
  if (!pending) {
    pending = new Set();
    current.owners.set(signal, pending);
    const operations = pending;
    registerToolCleanup(signal, current, async () => {
      // Agent cancellation stops awaiting tools before their work has settled.
      // In particular, a late attach must finish before we detach its target.
      await Promise.allSettled([...operations]);
      current.owners.delete(signal);
      if (current.owners.size > 0) return;
      current.detaching = new Promise<void>(resolve => {
        try {
          chrome.debugger.detach(debuggee, () => {
            void chrome.runtime.lastError; // The tab may already be closed or detached.
            resolve();
          });
        } catch {
          resolve();
        }
      }).finally(() => {
        sessions.delete(key);
        current.onDetach?.();
      });
      await current.detaching;
    });
  }

  const operation = Promise.resolve().then(() => {
    signal.throwIfAborted();
    return execute();
  });
  pending.add(operation);
  try {
    return await operation;
  } finally {
    pending.delete(operation);
  }
};
