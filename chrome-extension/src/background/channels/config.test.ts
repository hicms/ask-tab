import {
  getChannelConfigs,
  getChannelConfig,
  saveChannelConfig,
  updateChannelConfig,
  deleteChannelConfig,
  createDefaultChannelConfig,
} from './config';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { ChannelConfig } from './types';

// ── Chrome storage mock ──
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
  enabled: false,
  allowedSenderIds: [],
  status: 'idle',
  credentials: {},
  ...overrides,
});

describe('channel config', () => {
  beforeEach(() => {
    storageData = {};
    vi.clearAllMocks();
  });

  // ── getChannelConfigs ──

  it('returns empty array when no data stored', async () => {
    const configs = await getChannelConfigs();
    expect(configs).toEqual([]);
  });

  it('returns stored configs', async () => {
    const configs = [makeConfig('telegram'), makeConfig('whatsapp')];
    storageData.channelConfigs = configs;

    const result = await getChannelConfigs();
    expect(result).toHaveLength(2);
    expect(result[0].channelId).toBe('telegram');
    expect(result[1].channelId).toBe('whatsapp');
  });

  // ── getChannelConfig ──

  it('returns matching config by channelId', async () => {
    storageData.channelConfigs = [makeConfig('telegram', { enabled: true })];

    const result = await getChannelConfig('telegram');
    expect(result).toBeDefined();
    expect(result?.channelId).toBe('telegram');
    expect(result?.enabled).toBe(true);
  });

  it('returns undefined when channel not found', async () => {
    storageData.channelConfigs = [makeConfig('telegram')];

    const result = await getChannelConfig('whatsapp');
    expect(result).toBeUndefined();
  });

  // ── saveChannelConfig ──

  it('inserts new config when none exists', async () => {
    await saveChannelConfig(makeConfig('telegram', { credentials: { botToken: '123:abc' } }));

    const configs = await getChannelConfigs();
    expect(configs).toHaveLength(1);
    expect(configs[0].channelId).toBe('telegram');
    expect(configs[0].credentials.botToken).toBe('123:abc');
  });

  it('updates existing config (upsert)', async () => {
    await saveChannelConfig(makeConfig('telegram'));
    await saveChannelConfig(makeConfig('telegram', { enabled: true, status: 'passive' }));

    const configs = await getChannelConfigs();
    expect(configs).toHaveLength(1);
    expect(configs[0].enabled).toBe(true);
    expect(configs[0].status).toBe('passive');
  });

  // ── updateChannelConfig ──

  it('merges partial updates into existing config', async () => {
    await saveChannelConfig(makeConfig('telegram', { credentials: { botToken: 'original' } }));

    await updateChannelConfig('telegram', { enabled: true, status: 'passive' });

    const result = await getChannelConfig('telegram');
    expect(result?.enabled).toBe(true);
    expect(result?.status).toBe('passive');
    // Original fields preserved
    expect(result?.channelId).toBe('telegram');
    expect(result?.credentials.botToken).toBe('original');
  });

  // ── deleteChannelConfig ──

  it('removes the config for the given channelId', async () => {
    await saveChannelConfig(makeConfig('telegram'));
    await saveChannelConfig(makeConfig('whatsapp'));

    await deleteChannelConfig('telegram');

    const configs = await getChannelConfigs();
    expect(configs).toHaveLength(1);
    expect(configs[0].channelId).toBe('whatsapp');
  });

  // ── createDefaultChannelConfig ──

  it('returns correct defaults', () => {
    const config = createDefaultChannelConfig('telegram');
    expect(config).toEqual({
      channelId: 'telegram',
      enabled: false,
      allowedSenderIds: [],
      status: 'idle',
      credentials: {},
    });
  });

  // ── Mutex serialization ──

  it('concurrent writes do not clobber each other', async () => {
    // Seed initial config so both updates have something to work with
    await saveChannelConfig(makeConfig('telegram'));

    // Fire two concurrent updates that each modify different fields
    const p1 = updateChannelConfig('telegram', { enabled: true });
    const p2 = updateChannelConfig('telegram', { status: 'passive' });

    await Promise.all([p1, p2]);

    const result = await getChannelConfig('telegram');
    // Both updates should have been applied thanks to the mutex serialization
    expect(result?.enabled).toBe(true);
    expect(result?.status).toBe('passive');
  });
});
