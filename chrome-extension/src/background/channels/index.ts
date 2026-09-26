import { createDefaultChannelConfig, getChannelConfig, updateChannelConfig } from './config';
import {
  connectTelegram,
  connectWhatsApp,
  getChannelView,
  isServerChannelId,
  listChannels,
  removeChannel,
  setChannelEnabled,
} from './gateway';
import { setChannelPolling, stopChannelPolling } from './poller';
import { registerBotCommands } from './telegram/commands';
import { AskServiceError } from '../ask-service/client';
import { createLogger } from '../logging/logger-buffer';
import { askSessionStorage } from '@extension/storage';
import type { ChannelView, ServerChannelId } from './gateway';
import type { ChannelConfig } from './types';

const initLog = createLogger('channel-init');

let sync: Promise<unknown> = Promise.resolve();

const syncChannels = async (): Promise<ChannelView[]> => {
  if (!(await askSessionStorage.get())) {
    await stopChannelPolling();
    return [];
  }
  let views: ChannelView[];
  try {
    views = await listChannels();
  } catch (err) {
    if (err instanceof AskServiceError && err.status === 401) {
      await stopChannelPolling();
      return [];
    }
    throw err;
  }
  initLog.info('Channels synced', {
    channels: views.map(view => `${view.channel}:${view.status}`),
  });
  await setChannelPolling(views.some(view => view.enabled));
  return views;
};

/**
 * Read the server channel accounts and start or stop polling to match.
 * A signed-out user resolves quietly with no channels.
 */
const initChannels = (): Promise<ChannelView[]> => {
  const next = sync.then(syncChannels, syncChannels);
  sync = next.catch(() => {});
  return next;
};

const parseChannelId = (value: unknown): ServerChannelId => {
  if (!isServerChannelId(value)) throw new Error(`Unknown channel: ${String(value)}`);
  return value;
};

/** Refresh polling after a change; the change itself already succeeded. */
const refreshAfterChange = async (): Promise<void> => {
  await initChannels().catch(err =>
    initLog.warn('Channel refresh failed', { error: err instanceof Error ? err.message : err }),
  );
};

const getChannelState = async (
  channelIdValue: unknown,
): Promise<{ config: ChannelConfig; view: ChannelView | null; signedIn: boolean }> => {
  const channelId = parseChannelId(channelIdValue);
  const config = (await getChannelConfig(channelId)) ?? createDefaultChannelConfig(channelId);
  if (!(await askSessionStorage.get())) return { config, view: null, signedIn: false };
  return { config, view: await getChannelView(channelId), signedIn: true };
};

/** Only local routing settings are saved here; the server owns the connection. */
const saveLocalChannelConfig = async (
  channelIdValue: unknown,
  updates: Record<string, unknown>,
): Promise<void> => {
  const channelId = parseChannelId(channelIdValue);
  const patch: Partial<Omit<ChannelConfig, 'channelId'>> = {};
  if (Array.isArray(updates.allowedSenderIds)) {
    patch.allowedSenderIds = updates.allowedSenderIds.filter(
      (id): id is string => typeof id === 'string',
    );
  }
  if ('modelId' in updates) {
    patch.modelId = typeof updates.modelId === 'string' ? updates.modelId : undefined;
  }
  await updateChannelConfig(channelId, patch);
};

const connectChannel = async (request: Record<string, unknown>): Promise<ChannelView> => {
  const channelId = parseChannelId(request.channelId);
  let view: ChannelView;
  if (channelId === 'telegram') {
    const botToken = typeof request.botToken === 'string' ? request.botToken.trim() : '';
    if (!botToken) throw new Error('Bot token is required');
    view = await connectTelegram(botToken);
    void registerBotCommands();
  } else {
    view = await connectWhatsApp({
      acceptFromMe: typeof request.acceptFromMe === 'boolean' ? request.acceptFromMe : true,
      acceptFromOthers:
        typeof request.acceptFromOthers === 'boolean' ? request.acceptFromOthers : false,
    });
  }
  await refreshAfterChange();
  return view;
};

const setServerChannelEnabled = async (
  channelIdValue: unknown,
  enabled: boolean,
): Promise<ChannelView> => {
  const view = await setChannelEnabled(parseChannelId(channelIdValue), enabled);
  await refreshAfterChange();
  return view;
};

const removeServerChannel = async (channelIdValue: unknown): Promise<void> => {
  await removeChannel(parseChannelId(channelIdValue));
  await refreshAfterChange();
};

export {
  initChannels,
  getChannelState,
  saveLocalChannelConfig,
  connectChannel,
  setServerChannelEnabled,
  removeServerChannel,
};
