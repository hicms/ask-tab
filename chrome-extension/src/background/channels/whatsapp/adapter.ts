import { formatWhatsAppText } from './format';
import { createLogger } from '../../logging/logger-buffer';
import { downloadQueuedMedia, sendWhatsAppText } from '../gateway';
import { splitMessage } from '../utils';
import type {
  ChannelAdapter,
  ChannelInboundMessage,
  ChannelOutboundMessage,
  ChannelSendResult,
} from '../types';

const waLog = createLogger('wa-adapter');

const MAX_WA_MESSAGE_LENGTH = 4096;

const whatsappAdapter: ChannelAdapter = {
  id: 'whatsapp',
  label: 'WhatsApp',
  maxMessageLength: MAX_WA_MESSAGE_LENGTH,

  sendMessage: async (msg: ChannelOutboundMessage): Promise<ChannelSendResult> => {
    try {
      const chunks = splitMessage(formatWhatsAppText(msg.text), MAX_WA_MESSAGE_LENGTH);
      if (chunks.length === 0) return { ok: true };

      let lastMessageId: string | undefined;
      for (let i = 0; i < chunks.length; i++) {
        const result = await sendWhatsAppText(msg.to, chunks[i]);
        lastMessageId = result.messageId;
        waLog.debug('WhatsApp chunk sent', { to: msg.to, chunkIndex: i, messageId: lastMessageId });
      }
      return { ok: true, messageId: lastMessageId };
    } catch (err) {
      const error = err instanceof Error ? err.message : 'Send failed';
      waLog.error('WhatsApp send failed', { to: msg.to, error });
      return { ok: false, error };
    }
  },

  downloadMedia: async (msg: ChannelInboundMessage): Promise<ArrayBuffer> => {
    if (!msg.mediaFileId) throw new Error('Message has no media');
    return downloadQueuedMedia(msg.mediaFileId);
  },

  formatSenderDisplay: (msg: ChannelInboundMessage): string =>
    msg.senderName ?? msg.senderUsername ?? `+${msg.senderId.split('@')[0]}`,
};

export { whatsappAdapter };
