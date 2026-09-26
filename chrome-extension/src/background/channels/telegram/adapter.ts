import { validateBotToken, sendTelegramMessage, MAX_TG_MESSAGE_LENGTH } from './bot-api';
import type {
  ChannelAdapter,
  ChannelInboundMessage,
  ChannelOutboundMessage,
  ChannelSendResult,
} from '../types';

const createTelegramAdapter = (botToken: string): ChannelAdapter => ({
  id: 'telegram',
  label: 'Telegram',
  maxMessageLength: MAX_TG_MESSAGE_LENGTH,

  validateAuth: async () => {
    const result = await validateBotToken(botToken);
    if (result.valid) {
      return {
        valid: true,
        identity: result.botUser?.username ? `@${result.botUser.username}` : undefined,
      };
    }
    return { valid: false, error: result.error };
  },

  sendMessage: async (msg: ChannelOutboundMessage): Promise<ChannelSendResult> => {
    try {
      await sendTelegramMessage(botToken, msg.to, msg.text);
      return { ok: true };
    } catch (err) {
      return { ok: false, error: err instanceof Error ? err.message : 'Send failed' };
    }
  },

  formatSenderDisplay: (msg: ChannelInboundMessage): string =>
    msg.senderName ?? msg.senderUsername ?? `User ${msg.senderId}`,
});

export { createTelegramAdapter };
