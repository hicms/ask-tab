import type { ChannelConfig } from './types';

const STORAGE_KEY = 'channelConfigs';

// F3: Serialize all config read-modify-write operations to prevent race conditions
let configMutex: Promise<void> = Promise.resolve();
const withConfigLock = <T>(fn: () => Promise<T>): Promise<T> => {
  const next = configMutex.then(fn, fn);
  configMutex = next.then(
    () => {},
    () => {},
  );
  return next;
};

/** Read all channel configs from chrome.storage.local */
const getChannelConfigs = async (): Promise<ChannelConfig[]> => {
  const data = await chrome.storage.local.get(STORAGE_KEY);
  return (data[STORAGE_KEY] as ChannelConfig[] | undefined) ?? [];
};

/** Get config for a specific channel */
const getChannelConfig = async (channelId: string): Promise<ChannelConfig | undefined> => {
  const configs = await getChannelConfigs();
  return configs.find(c => c.channelId === channelId);
};

/** Save (upsert) a channel config — serialized to prevent concurrent write clobber */
const saveChannelConfig = (config: ChannelConfig): Promise<void> =>
  withConfigLock(async () => {
    const configs = await getChannelConfigs();
    const idx = configs.findIndex(c => c.channelId === config.channelId);
    if (idx >= 0) {
      configs[idx] = config;
    } else {
      configs.push(config);
    }
    await chrome.storage.local.set({ [STORAGE_KEY]: configs });
  });

/** Update specific fields on a channel config — serialized to prevent concurrent write clobber */
const updateChannelConfig = (channelId: string, updates: Partial<ChannelConfig>): Promise<void> =>
  withConfigLock(async () => {
    const configs = await getChannelConfigs();
    const idx = configs.findIndex(c => c.channelId === channelId);
    if (idx >= 0) {
      configs[idx] = { ...configs[idx], ...updates };
      await chrome.storage.local.set({ [STORAGE_KEY]: configs });
    }
  });

/** Delete a channel config */
const deleteChannelConfig = (channelId: string): Promise<void> =>
  withConfigLock(async () => {
    const configs = await getChannelConfigs();
    const filtered = configs.filter(c => c.channelId !== channelId);
    await chrome.storage.local.set({ [STORAGE_KEY]: filtered });
  });

/** Create a default ChannelConfig for a given channel */
const createDefaultChannelConfig = (channelId: string): ChannelConfig => ({
  channelId,
  enabled: false,
  allowedSenderIds: [],
  status: 'idle',
  credentials: {},
});

export {
  getChannelConfigs,
  getChannelConfig,
  saveChannelConfig,
  updateChannelConfig,
  deleteChannelConfig,
  createDefaultChannelConfig,
};
