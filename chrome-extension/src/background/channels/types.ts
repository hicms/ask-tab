// ──────────────────────────────────────────────
// Channel Abstraction Types
// ──────────────────────────────────────────────

/** Inbound message from any channel, normalized to a common shape */
interface ChannelInboundMessage {
  channelMessageId?: string;
  channelChatId: string;
  senderId: string;
  senderName?: string;
  senderUsername?: string;
  body: string;
  timestamp: number;
  chatType: 'direct' | 'group';
  fromMe?: boolean;
  replyToId?: string;
  /** Channel-specific handle passed to `ChannelAdapter.downloadMedia`. */
  mediaFileId?: string;
  mediaMimeType?: string;
}

/** Outbound message to any channel */
interface ChannelOutboundMessage {
  to: string;
  text: string;
  replyToId?: string;
  parseMode?: 'markdown' | 'html' | 'plain';
}

/** Result of sending a message */
interface ChannelSendResult {
  ok: boolean;
  messageId?: string;
  error?: string;
}

/** Channel adapter — each channel implements this */
interface ChannelAdapter {
  readonly id: string;
  readonly label: string;
  readonly maxMessageLength: number;

  /** Send a text message */
  sendMessage(msg: ChannelOutboundMessage): Promise<ChannelSendResult>;

  /** Download the audio attached to an inbound message (requires `mediaFileId`). */
  downloadMedia(msg: ChannelInboundMessage): Promise<ArrayBuffer>;

  /** Get display name for a sender */
  formatSenderDisplay(msg: ChannelInboundMessage): string;
}

/**
 * Local per-channel settings in chrome.storage.local. Connection state and
 * credentials live on the AskTab server.
 */
interface ChannelConfig {
  channelId: string;
  allowedSenderIds: string[];
  modelId?: string;
  lastActivityAt?: number;
}

export type {
  ChannelInboundMessage,
  ChannelOutboundMessage,
  ChannelSendResult,
  ChannelAdapter,
  ChannelConfig,
};
