import type { ChannelInboundMessage } from '../types';
import type { WaInboundUpdate } from './types';

/** Normalized result including the channel-specific offset for dedup */
interface NormalizedUpdate {
  message: ChannelInboundMessage;
  offset: number;
}

/** Direction filter config — controls which messages are processed */
interface DirectionConfig {
  acceptFromMe?: boolean;
  acceptFromOthers?: boolean;
}

/** Convert a WhatsApp inbound update to a channel-agnostic inbound message, or null if not applicable */
const normalizeWhatsAppUpdate = (
  update: WaInboundUpdate,
  direction: DirectionConfig = {},
): NormalizedUpdate | null => {
  // Direction filtering (defaults: acceptFromMe=true, acceptFromOthers=false)
  const acceptFromMe = direction.acceptFromMe ?? true;
  const acceptFromOthers = direction.acceptFromOthers ?? false;

  if (update.fromMe && !acceptFromMe) return null;
  if (!update.fromMe && !acceptFromOthers) return null;

  // Skip empty messages
  if (!update.body.trim()) return null;

  return {
    message: {
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
      // Propagate audio flag so agent-handler can detect inbound audio for TTS
      ...(update.isAudio ? { mediaFileId: 'audio', mediaMimeType: 'audio/ogg' } : {}),
    },
    // WhatsApp uses push delivery, not offset-based polling. The offset here is
    // only used for config persistence (lastPollOffset). Dedup is handled by
    // channelMessageId in the message bridge's trackMessageId set.
    offset: update.timestamp,
  };
};

export { normalizeWhatsAppUpdate };
export type { NormalizedUpdate };
