import { downloadFile, getFile, sendTelegramMessage, MAX_TG_MESSAGE_LENGTH } from './bot-api';
import type {
  ChannelAdapter,
  ChannelInboundMessage,
  ChannelOutboundMessage,
  ChannelSendResult,
} from '../types';

const telegramAdapter: ChannelAdapter = {
  id: 'telegram',
  label: 'Telegram',
  maxMessageLength: MAX_TG_MESSAGE_LENGTH,

  sendMessage: async (msg: ChannelOutboundMessage): Promise<ChannelSendResult> => {
    try {
      await sendTelegramMessage(msg.to, msg.text);
      return { ok: true };
    } catch (err) {
      return { ok: false, error: err instanceof Error ? err.message : 'Send failed' };
    }
  },

  downloadMedia: async (msg: ChannelInboundMessage): Promise<ArrayBuffer> => {
    if (!msg.mediaFileId) throw new Error('Message has no media');
    const { filePath } = await getFile(msg.mediaFileId);
    return downloadFile(filePath);
  },

  formatSenderDisplay: (msg: ChannelInboundMessage): string =>
    msg.senderName ?? msg.senderUsername ?? `User ${msg.senderId}`,
};

export { telegramAdapter };
