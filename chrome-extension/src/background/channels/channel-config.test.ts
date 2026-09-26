import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

// Mock chrome.storage.local
const mockStorage: Record<string, unknown> = {};
const mockStorageLocal = {
  get: vi.fn((keys: string | string[]) => {
    const result: Record<string, unknown> = {};
    const keyList = typeof keys === 'string' ? [keys] : keys;
    for (const k of keyList) {
      if (k in mockStorage) result[k] = mockStorage[k];
    }
    return Promise.resolve(result);
  }),
  set: vi.fn((items: Record<string, unknown>) => {
    Object.assign(mockStorage, items);
    return Promise.resolve();
  }),
};

beforeAll(() => {
  Object.defineProperty(globalThis, 'chrome', {
    value: {
      storage: { local: mockStorageLocal },
    },
    writable: true,
  });
});

describe('channel config', () => {
  /* eslint-disable @typescript-eslint/no-explicit-any */
  let getChannelConfigs: any;
  let getChannelConfig: any;
  let saveChannelConfig: any;
  let updateChannelConfig: any;
  let deleteChannelConfig: any;
  let createDefaultChannelConfig: any;
  /* eslint-enable @typescript-eslint/no-explicit-any */

  beforeEach(async () => {
    // Clear storage between tests
    for (const key of Object.keys(mockStorage)) {
      delete mockStorage[key];
    }
    vi.clearAllMocks();

    const mod = await import('./config');
    getChannelConfigs = mod.getChannelConfigs;
    getChannelConfig = mod.getChannelConfig;
    saveChannelConfig = mod.saveChannelConfig;
    updateChannelConfig = mod.updateChannelConfig;
    deleteChannelConfig = mod.deleteChannelConfig;
    createDefaultChannelConfig = mod.createDefaultChannelConfig;
  });

  it('returns empty array when no configs exist', async () => {
    const configs = await getChannelConfigs();
    expect(configs).toEqual([]);
  });

  it('saves and retrieves a config', async () => {
    const config = createDefaultChannelConfig('telegram');
    config.credentials = { botToken: '123:abc' };
    await saveChannelConfig(config);

    const result = await getChannelConfig('telegram');
    expect(result?.channelId).toBe('telegram');
    expect(result?.credentials.botToken).toBe('123:abc');
  });

  it('updates existing config (upsert)', async () => {
    const config = createDefaultChannelConfig('telegram');
    await saveChannelConfig(config);

    config.enabled = true;
    await saveChannelConfig(config);

    const configs = await getChannelConfigs();
    expect(configs).toHaveLength(1);
    expect(configs[0].enabled).toBe(true);
  });

  it('updates specific fields', async () => {
    const config = createDefaultChannelConfig('telegram');
    await saveChannelConfig(config);

    await updateChannelConfig('telegram', { enabled: true, status: 'passive' });

    const result = await getChannelConfig('telegram');
    expect(result?.enabled).toBe(true);
    expect(result?.status).toBe('passive');
    expect(result?.channelId).toBe('telegram'); // other fields preserved
  });

  it('deletes a config', async () => {
    await saveChannelConfig(createDefaultChannelConfig('telegram'));
    await saveChannelConfig(createDefaultChannelConfig('whatsapp'));

    await deleteChannelConfig('telegram');

    const configs = await getChannelConfigs();
    expect(configs).toHaveLength(1);
    expect(configs[0].channelId).toBe('whatsapp');
  });

  it('createDefaultChannelConfig returns correct shape', () => {
    const config = createDefaultChannelConfig('telegram');
    expect(config).toEqual({
      channelId: 'telegram',
      enabled: false,
      allowedSenderIds: [],
      status: 'idle',
      credentials: {},
    });
  });

  it('update does nothing for non-existent channel', async () => {
    await updateChannelConfig('nonexistent', { enabled: true });
    const configs = await getChannelConfigs();
    expect(configs).toHaveLength(0);
  });
});
