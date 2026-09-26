import { getChannelConfigs } from './config';
import { listChannels } from './gateway';
import type { ChannelView } from './gateway';
import type { ChannelConfig } from './types';

const canDeliver = (view: ChannelView): boolean => view.enabled && view.status === 'connected';

/**
 * The first channel that is enabled and connected on the server and has at
 * least one local allowed sender. Resolves to undefined when none qualifies or
 * the server cannot be asked (e.g. signed out).
 */
const findActiveChannel = async (): Promise<ChannelConfig | undefined> => {
  let views: ChannelView[];
  try {
    views = await listChannels();
  } catch {
    return undefined;
  }
  const configs = await getChannelConfigs();
  for (const view of views) {
    if (!canDeliver(view)) continue;
    const config = configs.find(c => c.channelId === view.channel);
    if (config && config.allowedSenderIds.length > 0) return config;
  }
  return undefined;
};

/**
 * Whether the server would deliver on this channel now. The server still
 * accepts sends on a paused channel, so scheduled deliveries must ask first.
 */
const isChannelDeliverable = async (channelId: string): Promise<boolean> => {
  try {
    return (await listChannels()).some(view => view.channel === channelId && canDeliver(view));
  } catch {
    return false;
  }
};

export { findActiveChannel, isChannelDeliverable };
