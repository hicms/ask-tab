/** Unconditional diagnostics for browser contexts, independent of storage and React. */
const diagnostics = {
  // Resolve each method at call time so console capture and DevTools hooks remain effective.
  /* eslint-disable no-console -- This module owns the browser diagnostic output boundary. */
  debug: (...args: unknown[]): void => console.debug(...args),
  info: (...args: unknown[]): void => console.info(...args),
  log: (...args: unknown[]): void => console.log(...args),
  warn: (...args: unknown[]): void => console.warn(...args),
  error: (...args: unknown[]): void => console.error(...args),
  /* eslint-enable no-console */
};

export { diagnostics };
