import { describe, expect, it, vi, beforeEach } from 'vitest';
import type { LogConfig } from '@extension/shared';

let storageSubscriber: (() => void) | null = null;
let currentConfig: LogConfig = { enabled: true, level: 'info' };

// Mock @extension/storage
vi.mock('@extension/storage', () => ({
  logConfigStorage: {
    get: vi.fn(() => Promise.resolve(currentConfig)),
    subscribe: vi.fn((cb: () => void) => {
      storageSubscriber = cb;
    }),
  },
}));

// Dynamic import so mocks are in place
const { createLogger, getLogEntries, clearLogEntries, registerStreamPort, MAX_BUFFER_SIZE } =
  await import('./logger-buffer');

// Wait for initial config load
await new Promise(r => setTimeout(r, 10));

beforeEach(() => {
  clearLogEntries();
  currentConfig = { enabled: true, level: 'info' };
  // Trigger config reload
  if (storageSubscriber) storageSubscriber();
  return new Promise(r => setTimeout(r, 10));
});

describe('createLogger', () => {
  it('logs entry at or above configured level', () => {
    const log = createLogger('general');
    log.info('hello');
    log.warn('warning');
    log.error('error');
    const { entries } = getLogEntries();
    expect(entries).toHaveLength(3);
    expect(entries[0].level).toBe('info');
    expect(entries[1].level).toBe('warn');
    expect(entries[2].level).toBe('error');
  });

  it('skips entry below configured level', async () => {
    currentConfig = { enabled: true, level: 'warn' };
    if (storageSubscriber) storageSubscriber();
    await new Promise(r => setTimeout(r, 10));

    const log = createLogger('general');
    log.trace('should skip');
    log.debug('should skip');
    log.info('should skip');
    log.warn('should log');
    log.error('should log');
    const { entries } = getLogEntries();
    expect(entries).toHaveLength(2);
    expect(entries[0].level).toBe('warn');
    expect(entries[1].level).toBe('error');
  });

  it('does not log when disabled', async () => {
    currentConfig = { enabled: false, level: 'trace' };
    if (storageSubscriber) storageSubscriber();
    await new Promise(r => setTimeout(r, 10));

    const log = createLogger('general');
    log.info('nope');
    const { entries } = getLogEntries();
    expect(entries).toHaveLength(0);
  });

  it('assigns sequential ids to entries', () => {
    const log = createLogger('general');
    log.info('first');
    log.info('second');
    log.info('third');
    const { entries } = getLogEntries();
    expect(entries[0].id).toBeLessThan(entries[1].id);
    expect(entries[1].id).toBeLessThan(entries[2].id);
  });

  it('includes timestamp, level, category, message', () => {
    const log = createLogger('stream');
    const before = Date.now();
    log.info('test msg');
    const after = Date.now();
    const { entries } = getLogEntries();
    expect(entries).toHaveLength(1);
    const entry = entries[0];
    expect(entry.timestamp).toBeGreaterThanOrEqual(before);
    expect(entry.timestamp).toBeLessThanOrEqual(after);
    expect(entry.level).toBe('info');
    expect(entry.category).toBe('stream');
    expect(entry.message).toBe('test msg');
  });

  it('includes optional data field when provided', () => {
    const log = createLogger('tool');
    log.info('with data', { key: 'value' });
    log.info('no data');
    const { entries } = getLogEntries();
    expect(entries[0].data).toEqual({ key: 'value' });
    expect(entries[1]).not.toHaveProperty('data');
  });
});

describe('ring buffer', () => {
  it('stores entries up to MAX_BUFFER_SIZE', () => {
    const log = createLogger('general');
    for (let i = 0; i < MAX_BUFFER_SIZE; i++) {
      log.info(`entry ${i}`);
    }
    const { entries } = getLogEntries();
    expect(entries).toHaveLength(MAX_BUFFER_SIZE);
  });

  it('evicts oldest entry when buffer is full', () => {
    const log = createLogger('general');
    for (let i = 0; i < MAX_BUFFER_SIZE + 5; i++) {
      log.info(`entry ${i}`);
    }
    const { entries } = getLogEntries();
    expect(entries).toHaveLength(MAX_BUFFER_SIZE);
    expect(entries[0].message).toBe('entry 5');
  });

  it('increments droppedCount on eviction', () => {
    const log = createLogger('general');
    for (let i = 0; i < MAX_BUFFER_SIZE + 10; i++) {
      log.info(`entry ${i}`);
    }
    const { dropped } = getLogEntries();
    expect(dropped).toBe(10);
  });

  it('getLogEntries returns copy of buffer with metadata', () => {
    const log = createLogger('general');
    log.info('test');
    const snapshot = getLogEntries();
    expect(snapshot.bufferSize).toBe(MAX_BUFFER_SIZE);
    expect(snapshot.entries).toHaveLength(1);
    // Ensure it's a copy
    snapshot.entries.pop();
    expect(getLogEntries().entries).toHaveLength(1);
  });
});

describe('clearLogEntries', () => {
  it('resets buffer to empty', () => {
    const log = createLogger('general');
    log.info('test');
    clearLogEntries();
    expect(getLogEntries().entries).toHaveLength(0);
  });

  it('resets droppedCount to 0', () => {
    const log = createLogger('general');
    for (let i = 0; i < MAX_BUFFER_SIZE + 5; i++) {
      log.info(`entry ${i}`);
    }
    expect(getLogEntries().dropped).toBe(5);
    clearLogEntries();
    expect(getLogEntries().dropped).toBe(0);
  });
});

describe('stream ports', () => {
  it('pushes new entries to registered ports', () => {
    const postMessage = vi.fn();
    const port = {
      postMessage,
      onDisconnect: { addListener: vi.fn() },
    } as unknown as chrome.runtime.Port;

    registerStreamPort(port);

    const log = createLogger('general');
    log.info('streamed');

    expect(postMessage).toHaveBeenCalledTimes(1);
    expect(postMessage).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'LOG_ENTRY',
        entry: expect.objectContaining({ message: 'streamed' }),
      }),
    );
  });

  it('removes port on disconnect', () => {
    const postMessage = vi.fn();
    let disconnectCb: (() => void) | undefined;
    const port = {
      postMessage,
      onDisconnect: {
        addListener: vi.fn((cb: () => void) => {
          disconnectCb = cb;
        }),
      },
    } as unknown as chrome.runtime.Port;

    registerStreamPort(port);

    // Simulate disconnect
    disconnectCb!();

    const log = createLogger('general');
    log.info('after disconnect');

    // postMessage should not be called after disconnect
    expect(postMessage).not.toHaveBeenCalled();
  });

  it('handles port.postMessage failure gracefully', () => {
    const postMessage = vi.fn(() => {
      throw new Error('port closed');
    });
    const port = {
      postMessage,
      onDisconnect: { addListener: vi.fn() },
    } as unknown as chrome.runtime.Port;

    registerStreamPort(port);

    const log = createLogger('general');
    // Should not throw
    expect(() => log.info('test')).not.toThrow();
    // Entry should still be in buffer
    expect(getLogEntries().entries).toHaveLength(1);
  });
});

describe('trace-level logging', () => {
  it('trace entries are logged when level is set to trace', async () => {
    currentConfig = { enabled: true, level: 'trace' };
    if (storageSubscriber) storageSubscriber();
    await new Promise(r => setTimeout(r, 10));

    const log = createLogger('stream');
    log.trace('LLM request', {
      model: 'gpt-4',
      system: 'You are helpful',
      messages: [{ role: 'user', content: 'hello' }],
      hasTools: true,
    });
    const { entries } = getLogEntries();
    expect(entries).toHaveLength(1);
    expect(entries[0].level).toBe('trace');
    expect(entries[0].message).toBe('LLM request');
    expect(entries[0].data).toEqual({
      model: 'gpt-4',
      system: 'You are helpful',
      messages: [{ role: 'user', content: 'hello' }],
      hasTools: true,
    });
  });

  it('trace entries are skipped when level is info', () => {
    const log = createLogger('stream');
    log.trace('LLM request', { model: 'gpt-4' });
    const { entries } = getLogEntries();
    expect(entries).toHaveLength(0);
  });

  it('trace entries include large data payloads (messages array)', async () => {
    currentConfig = { enabled: true, level: 'trace' };
    if (storageSubscriber) storageSubscriber();
    await new Promise(r => setTimeout(r, 10));

    const log = createLogger('stream');
    const largeMessages = Array.from({ length: 50 }, (_, i) => ({
      role: 'user',
      content: `message ${i} with some content to simulate a real conversation turn`,
    }));
    log.trace('LLM request', { messages: largeMessages });
    const { entries } = getLogEntries();
    expect(entries).toHaveLength(1);
    expect(entries[0].data).toEqual({ messages: largeMessages });
  });
});

describe('config reactivity', () => {
  it('reacts to storage change events', async () => {
    currentConfig = { enabled: true, level: 'error' };
    if (storageSubscriber) storageSubscriber();
    await new Promise(r => setTimeout(r, 10));

    const log = createLogger('general');
    log.info('should be skipped');
    log.error('should be logged');
    const { entries } = getLogEntries();
    expect(entries).toHaveLength(1);
    expect(entries[0].level).toBe('error');
  });

  it('updates level filter dynamically', async () => {
    const log = createLogger('general');

    // Start at info
    log.debug('skip');
    expect(getLogEntries().entries).toHaveLength(0);

    // Change to debug
    currentConfig = { enabled: true, level: 'debug' };
    if (storageSubscriber) storageSubscriber();
    await new Promise(r => setTimeout(r, 10));

    log.debug('now visible');
    expect(getLogEntries().entries).toHaveLength(1);
  });

  it('stops logging when disabled via config change', async () => {
    const log = createLogger('general');
    log.info('first');
    expect(getLogEntries().entries).toHaveLength(1);

    currentConfig = { enabled: false, level: 'info' };
    if (storageSubscriber) storageSubscriber();
    await new Promise(r => setTimeout(r, 10));

    log.info('should not appear');
    expect(getLogEntries().entries).toHaveLength(1);
  });
});
