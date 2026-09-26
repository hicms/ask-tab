/** Stop waiting promptly even when an integration ignores its AbortSignal. */
export const withAbort = <T>(
  signal: AbortSignal | undefined,
  operation: () => T | PromiseLike<T>,
): Promise<T> => {
  if (signal?.aborted) return Promise.reject(signal.reason);
  return new Promise<T>((resolve, reject) => {
    const onAbort = () => reject(signal?.reason);
    signal?.addEventListener('abort', onAbort, { once: true });
    Promise.resolve()
      .then(() => {
        signal?.throwIfAborted();
        return operation();
      })
      .then(resolve, reject)
      .finally(() => signal?.removeEventListener('abort', onAbort));
  });
};
