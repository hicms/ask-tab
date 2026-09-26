import { handleChannelMessage } from './agent-handler';
import { getChannelConfig, updateChannelConfig } from './config';
import { getChannelAdapter } from './registry';
import { isBotCommand, handleBotCommand } from './telegram/commands';
import { normalizeTelegramUpdate } from './telegram/normalizer';
import { isAllowedSender } from './utils';
import { isWhatsAppCommand, handleWhatsAppCommand } from './whatsapp/commands';
import { normalizeWhatsAppUpdate } from './whatsapp/normalizer';
import { createLogger } from '../logging/logger-buffer';
import type { QueuedUpdate } from './gateway';
import type { TgUpdate } from './telegram/types';
import type { ChannelInboundMessage } from './types';
import type { WaInboundUpdate } from './whatsapp/types';

const bridgeLog = createLogger('channel-bridge');

const HANDLER_TIMEOUT_MS = 5 * 60_000; // 5 minutes — safety net matching LLM tool timeout

// The server redelivers items whose lease expired before they were acked.
const recentMessageIds = new Set<string>();
const MAX_RECENT_IDS = 200;
const trackMessageId = (id: string): boolean => {
  if (recentMessageIds.has(id)) return true; // already processed
  recentMessageIds.add(id);
  if (recentMessageIds.size > MAX_RECENT_IDS) {
    const first = recentMessageIds.values().next().value;
    if (first !== undefined) recentMessageIds.delete(first);
  }
  return false;
};

const normalizeQueuedUpdate = (item: QueuedUpdate): ChannelInboundMessage | null => {
  switch (item.channel) {
    case 'telegram':
      return normalizeTelegramUpdate(item.update as TgUpdate);
    case 'whatsapp':
      return normalizeWhatsAppUpdate(item.update as WaInboundUpdate, item);
    default:
      bridgeLog.warn('Unknown channel for normalization', { channelId: item.channel });
      return null;
  }
};

const runWithTimeout = async (task: Promise<void>): Promise<void> => {
  let timeoutId: ReturnType<typeof setTimeout> | undefined;
  try {
    await Promise.race([
      task,
      new Promise<never>((_, reject) => {
        timeoutId = setTimeout(
          () => reject(new Error('Channel handler timeout')),
          HANDLER_TIMEOUT_MS,
        );
      }),
    ]);
  } finally {
    clearTimeout(timeoutId);
  }
};

/**
 * Process one queued inbound message. Resolves to true when it came from an
 * allowed sender (and was answered), false when it was skipped.
 */
const handleQueuedUpdate = async (item: QueuedUpdate): Promise<boolean> => {
  const channelId = item.channel;
  const adapter = getChannelAdapter(channelId);
  if (!adapter) {
    bridgeLog.warn('No adapter for queued update', { channelId });
    return false;
  }

  const message = normalizeQueuedUpdate(item);
  if (!message) {
    bridgeLog.trace('Update skipped (not normalizable)', { channelId, id: item.id });
    return false;
  }

  // Telegram message ids are only unique within one chat.
  const messageKey = `${channelId}:${message.channelChatId}:${message.channelMessageId ?? item.id}`;
  if (trackMessageId(messageKey)) {
    bridgeLog.debug('Skipping duplicate message', { channelId, id: item.id });
    return false;
  }

  if (message.chatType !== 'direct') {
    bridgeLog.debug('Skipping non-DM message', { channelId, chatType: message.chatType });
    return false;
  }

  const config = await getChannelConfig(channelId);
  // Own messages are allowlisted by the chat they were sent to.
  const allowlistId = message.fromMe ? message.channelChatId : message.senderId;
  if (!config || !isAllowedSender(allowlistId, config)) {
    bridgeLog.warn('Message from non-allowed sender', {
      channelId,
      senderId: message.senderId,
      allowlistId,
      fromMe: message.fromMe,
    });
    return false;
  }

  await updateChannelConfig(channelId, { lastActivityAt: Date.now() });

  if (channelId === 'telegram' && isBotCommand(message.body)) {
    try {
      if (await handleBotCommand(message)) return true;
    } catch (err) {
      bridgeLog.error('Bot command handler failed', { channelId, error: String(err) });
      return true;
    }
  }

  if (channelId === 'whatsapp' && isWhatsAppCommand(message.body)) {
    try {
      if (await handleWhatsAppCommand(message, adapter)) return true;
    } catch (err) {
      bridgeLog.error('WhatsApp command handler failed', { channelId, error: String(err) });
      return true;
    }
  }

  bridgeLog.debug('Dispatching to agent handler', { channelId, senderId: message.senderId });
  try {
    await runWithTimeout(handleChannelMessage(message, adapter, config));
  } catch (err) {
    bridgeLog.error('Agent handler failed', { channelId, error: String(err) });
  }
  return true;
};

export { handleQueuedUpdate };
