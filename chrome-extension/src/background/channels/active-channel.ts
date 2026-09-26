import { getChannelConfigs } from './config';
import { listChannels } from './gateway';
import type { ChannelConfig } from './types';

/**
 * The first channel that is enabled and connected on the server and has at
 * least one local allowed sender. Resolves to undefined when none qualifies or
 * the server cannot be asked (e.g. signed out).
 */
const findActiveChannel = async (): Promise<ChannelConfig | undefined> => {
  let views: Awaited<ReturnType<typeof listChannels>>;
  try {
    views = await listChannels();
  } catch {
    return undefined;
  }
  const configs = await getChannelConfigs();
  for (const view of views) {
    if (!view.enabled || view.status !== 'connected') continue;
    const config = configs.find(c => c.channelId === view.channel);
    if (config && config.allowedSenderIds.length > 0) return config;
  }
  return undefined;
};

export { findActiveChannel };
