export const waitForPage = async (seconds = 1, signal?: AbortSignal): Promise<string> => {
  if (!Number.isFinite(seconds) || seconds < 0 || seconds > 10)
    return 'Error: "seconds" must be between 0 and 10.';
  if (signal?.aborted) return 'Error: Wait was cancelled.';
  return new Promise(resolve => {
    const finish = (result: string) => {
      clearTimeout(timer);
      signal?.removeEventListener('abort', abort);
      resolve(result);
    };
    const abort = () => finish('Error: Wait was cancelled.');
    const timer = setTimeout(
      () => finish(`Waited ${seconds} seconds. Take a new snapshot to inspect changes.`),
      seconds * 1000,
    );
    signal?.addEventListener('abort', abort, { once: true });
  });
};
