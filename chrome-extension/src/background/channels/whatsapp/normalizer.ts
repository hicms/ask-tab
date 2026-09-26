import type { ChannelInboundMessage } from '../types';
import type { WaInboundUpdate } from './types';

/** Queue metadata needed to fetch a voice note's bytes from the server. */
interface WaQueueItem {
  id: string;
  mediaType: string | null;
}

/** Convert a queued WhatsApp message to a channel-agnostic inbound message, or null to skip it */
const normalizeWhatsAppUpdate = (
  update: WaInboundUpdate,
  item: WaQueueItem,
): ChannelInboundMessage | null => {
  const isAudio = !!update.isAudio;
  if (!isAudio && !update.body.trim()) return null;

  return {
    channelMessageId: update.channelMessageId,
    channelChatId: update.channelChatId,
    senderId: update.senderId,
    senderName: update.senderName,
    // WhatsApp has no usernames — use phone number portion of JID for consistency
    senderUsername: update.senderId.split('@')[0],
    body: update.body,
    timestamp: update.timestamp,
    chatType: update.chatType,
    fromMe: update.fromMe,
    ...(isAudio ? { mediaFileId: item.id, mediaMimeType: item.mediaType ?? 'audio/ogg' } : {}),
  };
};

export { normalizeWhatsAppUpdate };
