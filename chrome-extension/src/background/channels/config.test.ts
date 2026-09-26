import {
  getChannelConfigs,
  getChannelConfig,
  updateChannelConfig,
  createDefaultChannelConfig,
} from './config';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { ChannelConfig } from './types';

let storageData: Record<string, unknown> = {};
vi.stubGlobal('chrome', {
  storage: {
    local: {
      get: vi.fn(async (key: string) => ({ [key]: storageData[key] })),
      set: vi.fn(async (data: Record<string, unknown>) => {
        Object.assign(storageData, data);
      }),
    },
  },
});

const makeConfig = (channelId: string, overrides: Partial<ChannelConfig> = {}): ChannelConfig => ({
  channelId,
  allowedSenderIds: [],
  ...overrides,
});

describe('channel config', () => {
  beforeEach(() => {
    storageData = {};
    vi.clearAllMocks();
  });

  it('returns empty array when no data stored', async () => {
    expect(await getChannelConfigs()).toEqual([]);
  });

  it('returns stored configs', async () => {
    storageData.channelConfigs = [makeConfig('telegram'), makeConfig('whatsapp')];

    const result = await getChannelConfigs();
    expect(result.map(c => c.channelId)).toEqual(['telegram', 'whatsapp']);
  });

  it('returns matching config by channelId', async () => {
    storageData.channelConfigs = [makeConfig('telegram', { allowedSenderIds: ['1'] })];

    const result = await getChannelConfig('telegram');
    expect(result?.allowedSenderIds).toEqual(['1']);
  });

  it('returns undefined when channel not found', async () => {
    storageData.channelConfigs = [makeConfig('telegram')];

    expect(await getChannelConfig('whatsapp')).toBeUndefined();
  });

  it('creates a config from defaults when updating a missing channel', async () => {
    await updateChannelConfig('telegram', { allowedSenderIds: ['42'] });

    expect(await getChannelConfigs()).toEqual([
      { channelId: 'telegram', allowedSenderIds: ['42'] },
    ]);
  });

  it('merges partial updates into an existing config', async () => {
    storageData.channelConfigs = [
      makeConfig('telegram', { allowedSenderIds: ['1'], modelId: 'm1' }),
      makeConfig('whatsapp'),
    ];

    await updateChannelConfig('telegram', { lastActivityAt: 123 });

    expect(await getChannelConfig('telegram')).toEqual({
      channelId: 'telegram',
      allowedSenderIds: ['1'],
      modelId: 'm1',
      lastActivityAt: 123,
    });
    expect(await getChannelConfigs()).toHaveLength(2);
  });

  it('returns the default shape', () => {
    expect(createDefaultChannelConfig('telegram')).toEqual({
      channelId: 'telegram',
      allowedSenderIds: [],
    });
  });

  it('serializes concurrent updates so neither is lost', async () => {
    await Promise.all([
      updateChannelConfig('telegram', { allowedSenderIds: ['1'] }),
      updateChannelConfig('telegram', { lastActivityAt: 5 }),
    ]);

    const result = await getChannelConfig('telegram');
    expect(result?.allowedSenderIds).toEqual(['1']);
    expect(result?.lastActivityAt).toBe(5);
  });
});
