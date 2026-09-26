// ──────────────────────────────────────────────
// WhatsApp Channel Types
// ──────────────────────────────────────────────

/** Inbound update from WhatsApp worker (offscreen → SW) */
interface WaInboundUpdate {
  channelMessageId: string;
  channelChatId: string;
  senderId: string;
  senderName?: string;
  body: string;
  timestamp: number;
  chatType: 'direct' | 'group';
  fromMe: boolean;
  /** True when the inbound message was an audio/voice message */
  isAudio?: boolean;
  /** Original sender JID before LID resolution (present when resolution changed the value) */
  originalSenderId?: string;
}

/** WhatsApp connection status */
type WaConnectionStatus =
  | 'connecting'
  | 'connected'
  | 'reconnecting'
  | 'logged_out'
  | 'disconnected';

export type { WaInboundUpdate, WaConnectionStatus };
