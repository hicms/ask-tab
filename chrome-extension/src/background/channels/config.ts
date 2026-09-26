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

/** Create a default ChannelConfig for a given channel */
const createDefaultChannelConfig = (channelId: string): ChannelConfig => ({
  channelId,
  allowedSenderIds: [],
});

/**
 * Merge fields into a channel config, creating it from defaults when missing.
 * Serialized to prevent concurrent write clobber.
 */
const updateChannelConfig = (
  channelId: string,
  updates: Partial<Omit<ChannelConfig, 'channelId'>>,
): Promise<void> =>
  withConfigLock(async () => {
    const configs = await getChannelConfigs();
    const idx = configs.findIndex(c => c.channelId === channelId);
    if (idx >= 0) {
      configs[idx] = { ...configs[idx], ...updates };
    } else {
      configs.push({ ...createDefaultChannelConfig(channelId), ...updates });
    }
    await chrome.storage.local.set({ [STORAGE_KEY]: configs });
  });

export { getChannelConfigs, getChannelConfig, updateChannelConfig, createDefaultChannelConfig };
