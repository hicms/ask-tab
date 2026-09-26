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

  /** Validate credentials (bot token, session, etc.) */
  validateAuth(): Promise<{ valid: boolean; identity?: string; error?: string }>;

  /** Send a text message */
  sendMessage(msg: ChannelOutboundMessage): Promise<ChannelSendResult>;

  /** Get display name for a sender */
  formatSenderDisplay(msg: ChannelInboundMessage): string;
}

/** Channel config — stored per channel in chrome.storage.local */
interface ChannelConfig {
  channelId: string;
  enabled: boolean;
  allowedSenderIds: string[];
  lastPollOffset?: number;
  status: 'idle' | 'active' | 'passive' | 'error';
  lastError?: string;
  lastActivityAt?: number;
  modelId?: string;
  acceptFromMe?: boolean;
  acceptFromOthers?: boolean;
  credentials: Record<string, string>;
}

// F18: ChannelMeta is defined in @extension/shared — import from there, not duplicated here

// ──────────────────────────────────────────────
// Internal Message Protocol (Offscreen <-> SW)
// ──────────────────────────────────────────────

interface ChannelUpdatesMessage {
  type: 'CHANNEL_UPDATES';
  channelId: string;
  updates: unknown[];
}

interface ChannelErrorMessage {
  type: 'CHANNEL_ERROR';
  channelId: string;
  error: string;
  retryable: boolean;
}

interface ChannelStartWorkerMessage {
  type: 'CHANNEL_START_WORKER';
  channelId: string;
  offset?: number;
  // F6: credentials removed — offscreen reads from storage to avoid broadcast exposure
}

interface ChannelStopWorkerMessage {
  type: 'CHANNEL_STOP_WORKER';
  channelId: string;
}

interface ChannelAckOffsetMessage {
  type: 'CHANNEL_ACK_OFFSET';
  channelId: string;
  offset: number;
}

/** Options page -> SW messages */
interface ChannelValidateAuthMessage {
  type: 'CHANNEL_VALIDATE_AUTH';
  channelId: string;
  credentials: Record<string, string>;
}

interface ChannelToggleMessage {
  type: 'CHANNEL_TOGGLE';
  channelId: string;
  enabled: boolean;
}

type ChannelMessage =
  | ChannelUpdatesMessage
  | ChannelErrorMessage
  | ChannelStartWorkerMessage
  | ChannelStopWorkerMessage
  | ChannelAckOffsetMessage
  | ChannelValidateAuthMessage
  | ChannelToggleMessage;

export type {
  ChannelInboundMessage,
  ChannelOutboundMessage,
  ChannelSendResult,
  ChannelAdapter,
  ChannelConfig,
  ChannelUpdatesMessage,
  ChannelErrorMessage,
  ChannelStartWorkerMessage,
  ChannelStopWorkerMessage,
  ChannelAckOffsetMessage,
  ChannelValidateAuthMessage,
  ChannelToggleMessage,
  ChannelMessage,
};
