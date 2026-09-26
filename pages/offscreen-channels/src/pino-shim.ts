import { diagnostics } from '@extension/shared/lib/diagnostics.js';
// ──────────────────────────────────────────────
// Pino Logger Shim for Browser
// ──────────────────────────────────────────────
// Baileys uses pino for logging. This provides a minimal console-based replacement.

interface Logger {
  level: string;
  info: (...args: unknown[]) => void;
  warn: (...args: unknown[]) => void;
  error: (...args: unknown[]) => void;
  debug: (...args: unknown[]) => void;
  trace: (...args: unknown[]) => void;
  fatal: (...args: unknown[]) => void;
  child: (bindings?: Record<string, unknown>) => Logger;
}

/** Pino numeric levels: lower = more verbose */
const LEVEL_VALUES: Record<string, number> = {
  trace: 10,
  debug: 20,
  info: 30,
  warn: 40,
  error: 50,
  fatal: 60,
  silent: Infinity,
};

const createLogger = (opts?: { level?: string } | string, prefix = '[baileys]'): Logger => {
  const level = typeof opts === 'string' ? opts : (opts?.level ?? 'warn');
  const threshold = LEVEL_VALUES[level] ?? LEVEL_VALUES.warn;

  const logger: Logger = {
    level,
    info: (...args) => threshold <= LEVEL_VALUES.info && diagnostics.info(prefix, ...args),
    warn: (...args) => threshold <= LEVEL_VALUES.warn && diagnostics.warn(prefix, ...args),
    error: (...args) => threshold <= LEVEL_VALUES.error && diagnostics.error(prefix, ...args),
    debug: (...args) => threshold <= LEVEL_VALUES.debug && diagnostics.debug(prefix, ...args),
    trace: (...args) =>
      threshold <= LEVEL_VALUES.trace && diagnostics.debug(`${prefix}:trace`, ...args),
    fatal: (...args) =>
      threshold <= LEVEL_VALUES.fatal && diagnostics.error(`${prefix}:fatal`, ...args),
    child: (bindings?: Record<string, unknown>) => {
      const tag = bindings ? Object.values(bindings).join(':') : '';
      return createLogger({ level }, tag ? `${prefix}:${tag}` : prefix);
    },
  };

  return logger;
};

export default createLogger;
export { createLogger };
