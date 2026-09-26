// ──────────────────────────────────────────────
// WhatsApp Channel Types
// ──────────────────────────────────────────────

/**
 * WhatsApp message as queued by the AskTab server. The server already applies
 * the direction settings and drops echoes of its own sends.
 */
interface WaInboundUpdate {
  channelMessageId: string;
  channelChatId: string;
  senderId: string;
  senderName?: string;
  /** Empty for voice notes. */
  body: string;
  timestamp: number;
  chatType: 'direct' | 'group';
  fromMe: boolean;
  isAudio?: boolean;
}

export type { WaInboundUpdate };
