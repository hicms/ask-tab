import {
  getChannelConfigs,
  getChannelConfig,
  saveChannelConfig,
  updateChannelConfig,
  createDefaultChannelConfig,
} from './config';
import {
  switchToPassiveMode,
  switchToActiveMode,
  maybeCloseOffscreenDocument,
} from './offscreen-manager';
import { createPassiveAlarm, clearPassiveAlarm } from './poller';
import { registerChannel } from './registry';
import { createTelegramAdapter } from './telegram/adapter';
import { validateBotToken } from './telegram/bot-api';
import { createWhatsAppAdapter } from './whatsapp/adapter';
import { createLogger } from '../logging/logger-buffer';
import { diagnostics } from '@extension/shared/lib/diagnostics.js';

const initLog = createLogger('channel-init');

/** Initialize all enabled channels on startup */
const initChannels = async (): Promise<void> => {
  const configs = await getChannelConfigs();
  diagnostics.log(`[channel-init] Found ${configs.length} channel config(s)`);
  initLog.info('Found channel configs', { count: configs.length });

  for (const config of configs) {
    if (!config.enabled) {
      diagnostics.log(`[channel-init] ${config.channelId}: disabled, skipping`);
      initLog.info('Channel disabled, skipping', { channelId: config.channelId });
      continue;
    }

    switch (config.channelId) {
      case 'telegram': {
        const token = config.credentials.botToken;
        if (!token) {
          diagnostics.warn(`[channel-init] ${config.channelId}: enabled but no bot token`);
          initLog.warn('Enabled but no bot token', { channelId: config.channelId });
          continue;
        }

        // Register the adapter
        const adapter = createTelegramAdapter(token);
        registerChannel(adapter);

        // Start in passive mode
        createPassiveAlarm(config.channelId);
        await updateChannelConfig(config.channelId, { status: 'passive' });
        diagnostics.log(`[channel-init] Telegram initialized (passive mode)`);
        initLog.info('Telegram channel initialized (passive mode)');
        break;
      }
      case 'whatsapp': {
        // WhatsApp always starts in active mode (persistent WebSocket)
        const adapter = createWhatsAppAdapter();
        registerChannel(adapter);
        await switchToActiveMode(config.channelId);
        diagnostics.log(`[channel-init] WhatsApp initialized (active mode)`);
        initLog.info('WhatsApp channel initialized (active mode)');
        break;
      }
    }
  }
};

/** Enable a channel and start polling — requires valid credentials */
const enableChannel = async (channelId: string): Promise<void> => {
  let config = await getChannelConfig(channelId);
  if (!config) {
    config = createDefaultChannelConfig(channelId);
  }

  // F12: Don't enable without credentials
  switch (channelId) {
    case 'telegram': {
      const token = config.credentials.botToken;
      if (!token) {
        initLog.warn('Cannot enable Telegram: no bot token configured');
        return;
      }
      const adapter = createTelegramAdapter(token);
      registerChannel(adapter);

      config.enabled = true;
      config.status = 'passive';
      await saveChannelConfig(config);

      createPassiveAlarm(channelId);
      initLog.info('Telegram channel enabled');
      break;
    }
    case 'whatsapp': {
      const adapter = createWhatsAppAdapter();
      registerChannel(adapter);

      config.enabled = true;
      config.status = 'active';
      await saveChannelConfig(config);

      await switchToActiveMode(channelId);
      initLog.info('WhatsApp channel enabled');
      break;
    }
    default:
      initLog.warn('Unknown channel', { channelId });
      return;
  }
};

/** Disable a channel and stop polling */
const disableChannel = async (channelId: string): Promise<void> => {
  const config = await getChannelConfig(channelId);
  if (!config) return;

  // Stop active mode if running
  if (config.status === 'active') {
    // Send stop worker message to offscreen for any channel type
    try {
      await chrome.runtime.sendMessage({
        type: 'CHANNEL_STOP_WORKER',
        channelId,
      });
    } catch {
      // Offscreen may already be gone
    }
    await switchToPassiveMode(channelId);
  }

  // Clear passive alarm
  await clearPassiveAlarm(channelId);

  // Update config
  await updateChannelConfig(channelId, {
    enabled: false,
    status: 'idle',
  });

  await maybeCloseOffscreenDocument();
  initLog.info('Channel disabled', { channelId });
};

/** Validate channel credentials from the Options page */
const validateChannelAuth = async (
  channelId: string,
  credentials: Record<string, string>,
): Promise<{ valid: boolean; identity?: string; error?: string }> => {
  switch (channelId) {
    case 'telegram': {
      const result = await validateBotToken(credentials.botToken ?? '');
      if (result.valid) {
        return {
          valid: true,
          identity: result.botUser?.username ? `@${result.botUser.username}` : undefined,
        };
      }
      return { valid: false, error: result.error };
    }
    case 'whatsapp': {
      const data = await chrome.storage.local.get('wa-auth-creds');
      if (data['wa-auth-creds']) {
        return { valid: true, identity: 'WhatsApp linked' };
      }
      return { valid: false, error: 'Not linked — scan QR code to connect' };
    }
    default:
      return { valid: false, error: `Unknown channel: ${channelId}` };
  }
};

/** Toggle a channel on/off */
const toggleChannel = async (channelId: string, enabled: boolean): Promise<void> => {
  if (enabled) {
    await enableChannel(channelId);
  } else {
    await disableChannel(channelId);
  }
};

export { initChannels, enableChannel, disableChannel, validateChannelAuth, toggleChannel };
