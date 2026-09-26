import { registerChannel, getChannelAdapter, getAllChannelIds } from './registry';
import { beforeAll, describe, expect, it, vi } from 'vitest';
import type { ChannelAdapter } from './types';

// Mock chrome.storage.local for the lazy rebuild path
beforeAll(() => {
  Object.defineProperty(globalThis, 'chrome', {
    value: {
      storage: {
        local: {
          get: vi.fn(() => Promise.resolve({})),
          set: vi.fn(() => Promise.resolve()),
        },
      },
    },
    writable: true,
  });
});

const makeAdapter = (id: string): ChannelAdapter => ({
  id,
  label: id.charAt(0).toUpperCase() + id.slice(1),
  maxMessageLength: 4096,
  validateAuth: async () => ({ valid: true }),
  sendMessage: async () => ({ ok: true }),
  formatSenderDisplay: () => 'User',
});

describe('channel registry', () => {
  it('registers and retrieves an adapter', async () => {
    const adapter = makeAdapter('test-channel');
    registerChannel(adapter);
    expect(await getChannelAdapter('test-channel')).toBe(adapter);
  });

  it('returns undefined for unregistered channel with no config', async () => {
    expect(await getChannelAdapter('nonexistent')).toBeUndefined();
  });

  it('lists all registered channel IDs', () => {
    registerChannel(makeAdapter('chan-a'));
    registerChannel(makeAdapter('chan-b'));
    const ids = getAllChannelIds();
    expect(ids).toContain('chan-a');
    expect(ids).toContain('chan-b');
  });

  it('overwrites adapter on re-register', async () => {
    const adapter1 = makeAdapter('overwrite-test');
    const adapter2 = makeAdapter('overwrite-test');
    registerChannel(adapter1);
    registerChannel(adapter2);
    expect(await getChannelAdapter('overwrite-test')).toBe(adapter2);
  });
});
