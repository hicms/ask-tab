import { telegramAdapter } from './telegram/adapter';
import { whatsappAdapter } from './whatsapp/adapter';
import type { ChannelAdapter } from './types';

const adapters = new Map<string, ChannelAdapter>([
  [telegramAdapter.id, telegramAdapter],
  [whatsappAdapter.id, whatsappAdapter],
]);

const getChannelAdapter = (channelId: string): ChannelAdapter | undefined =>
  adapters.get(channelId);

export { getChannelAdapter };
