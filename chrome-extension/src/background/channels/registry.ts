import { getChannelConfig } from './config';
import { createTelegramAdapter } from './telegram/adapter';
import { createWhatsAppAdapter } from './whatsapp/adapter';
import { diagnostics } from '@extension/shared/lib/diagnostics.js';
import type { ChannelAdapter } from './types';

const adapters = new Map<string, ChannelAdapter>();

const registerChannel = (adapter: ChannelAdapter): void => {
  adapters.set(adapter.id, adapter);
};

/**
 * Get a channel adapter, lazily reconstructing from persisted config if the
 * in-memory registry is empty (happens after MV3 service worker restarts).
 */
const getChannelAdapter = async (channelId: string): Promise<ChannelAdapter | undefined> => {
  const cached = adapters.get(channelId);
  if (cached) return cached;

  // SW was restarted and the in-memory map is empty — rebuild from config
  const config = await getChannelConfig(channelId);
  if (!config?.enabled) return undefined;

  switch (channelId) {
    case 'telegram': {
      const token = config.credentials.botToken;
      if (!token) return undefined;
      const adapter = createTelegramAdapter(token);
      adapters.set(channelId, adapter);
      diagnostics.log(`[channel-registry] Rebuilt adapter for ${channelId} from config`);
      return adapter;
    }
    case 'whatsapp': {
      const adapter = createWhatsAppAdapter();
      adapters.set(channelId, adapter);
      diagnostics.log(`[channel-registry] Rebuilt adapter for ${channelId} from config`);
      return adapter;
    }
    default:
      return undefined;
  }
};

const getChannelAdapterSync = (channelId: string): ChannelAdapter | undefined =>
  adapters.get(channelId);

const getAllChannelIds = (): string[] => [...adapters.keys()];

export { registerChannel, getChannelAdapter, getChannelAdapterSync, getAllChannelIds };
