import { LOG_LEVEL_PRIORITY } from '@extension/shared';
import { logConfigStorage } from '@extension/storage';
import type { LogLevel, LogCategory, LogEntry, LogConfig } from '@extension/shared';

// ── Configuration ───────────────────────────────

const MAX_BUFFER_SIZE = 1000;

let config: LogConfig = { enabled: false, level: 'info' };

// Load initial config (catch to avoid unhandled rejection if storage is unavailable)
const configReady: Promise<void> = logConfigStorage
  .get()
  .then(c => {
    config = c;
  })
  .catch(() => {});

// React to live config changes
logConfigStorage.subscribe(() => {
  logConfigStorage
    .get()
    .then(c => {
      config = c;
    })
    .catch(() => {});
});

// ── Ring Buffer ─────────────────────────────────

let buffer: LogEntry[] = [];
let nextId = 1;
let droppedCount = 0;

const shouldLog = (level: LogLevel): boolean => {
  if (!config.enabled) return false;
  return LOG_LEVEL_PRIORITY[level] >= LOG_LEVEL_PRIORITY[config.level];
};

const addEntry = (entry: LogEntry): void => {
  if (buffer.length >= MAX_BUFFER_SIZE) {
    buffer.shift();
    droppedCount++;
  }
  buffer.push(entry);

  // Push to live stream ports
  for (const port of streamPorts) {
    try {
      port.postMessage({ type: 'LOG_ENTRY', entry });
    } catch {
      streamPorts.delete(port);
    }
  }
};

// ── Logger Factory ──────────────────────────────

interface Logger {
  trace: (message: string, data?: unknown) => void;
  debug: (message: string, data?: unknown) => void;
  info: (message: string, data?: unknown) => void;
  warn: (message: string, data?: unknown) => void;
  error: (message: string, data?: unknown) => void;
}

const createLogger = (category: LogCategory): Logger => {
  const log = (level: LogLevel, message: string, data?: unknown): void => {
    if (!shouldLog(level)) return;
    const entry: LogEntry = {
      id: nextId++,
      timestamp: Date.now(),
      level,
      category,
      message,
      ...(data !== undefined ? { data } : {}),
    };
    addEntry(entry);
  };

  return {
    trace: (message, data) => log('trace', message, data),
    debug: (message, data) => log('debug', message, data),
    info: (message, data) => log('info', message, data),
    warn: (message, data) => log('warn', message, data),
    error: (message, data) => log('error', message, data),
  };
};

// ── Buffer Access ───────────────────────────────

interface LogSnapshot {
  entries: LogEntry[];
  bufferSize: number;
  dropped: number;
}

const getLogEntries = (): LogSnapshot => ({
  entries: [...buffer],
  bufferSize: MAX_BUFFER_SIZE,
  dropped: droppedCount,
});

const clearLogEntries = (): void => {
  buffer = [];
  droppedCount = 0;
  nextId = 1;
};

// ── Stream Ports ────────────────────────────────

const streamPorts = new Set<chrome.runtime.Port>();

const registerStreamPort = (port: chrome.runtime.Port): void => {
  streamPorts.add(port);
  port.onDisconnect.addListener(() => {
    streamPorts.delete(port);
  });
};

export {
  createLogger,
  configReady,
  getLogEntries,
  clearLogEntries,
  registerStreamPort,
  MAX_BUFFER_SIZE,
};
export type { Logger, LogSnapshot };
