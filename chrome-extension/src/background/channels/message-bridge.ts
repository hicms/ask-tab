import { handleChannelMessage } from './agent-handler';
import { getChannelConfig, updateChannelConfig } from './config';
import { switchToActiveMode } from './offscreen-manager';
import { getChannelAdapter } from './registry';
import { isBotCommand, handleBotCommand } from './telegram/commands';
import { normalizeTelegramUpdate } from './telegram/normalizer';
import { isAllowedSender } from './utils';
import { isWhatsAppCommand, handleWhatsAppCommand } from './whatsapp/commands';
import { normalizeWhatsAppUpdate } from './whatsapp/normalizer';
import { createLogger } from '../logging/logger-buffer';
import { diagnostics } from '@extension/shared/lib/diagnostics.js';
import type { TgUpdate } from './telegram/types';
import type { ChannelInboundMessage } from './types';
import type { WaInboundUpdate } from './whatsapp/types';

const bridgeLog = createLogger('channel-bridge');

const HANDLER_TIMEOUT_MS = 5 * 60_000; // 5 minutes — safety net matching LLM tool timeout

// R9: Track recently processed message IDs to prevent duplicate delivery on restart
const recentMessageIds = new Set<string>();
const MAX_RECENT_IDS = 200;
const trackMessageId = (id: string): boolean => {
  if (recentMessageIds.has(id)) return true; // already processed
  recentMessageIds.add(id);
  // Evict oldest entries if set grows too large
  if (recentMessageIds.size > MAX_RECENT_IDS) {
    const first = recentMessageIds.values().next().value;
    if (first !== undefined) recentMessageIds.delete(first);
  }
  return false;
};

/** Normalized result with channel-agnostic offset */
interface NormalizedWithOffset {
  message: ChannelInboundMessage;
  offset: number;
}

/** Process raw updates from a channel, normalize, filter, and dispatch to agent handler */
const handleChannelUpdates = async (
  channelId: string,
  rawUpdates: unknown[],
): Promise<number | undefined> => {
  bridgeLog.trace('handleChannelUpdates called', { channelId, updateCount: rawUpdates.length });

  const adapter = await getChannelAdapter(channelId);
  if (!adapter) {
    diagnostics.warn(
      `[channel-bridge] No adapter for ${channelId} — channel not enabled or missing credentials`,
    );
    return undefined;
  }

  const config = await getChannelConfig(channelId);
  if (!config || !config.enabled) {
    bridgeLog.debug('Channel not enabled, skipping updates', { channelId });
    return undefined;
  }

  let maxOffset: number | undefined;
  let hadValidMessage = false;

  for (const raw of rawUpdates) {
    const normalized = normalizeUpdate(channelId, raw, config);
    if (!normalized) {
      bridgeLog.trace('Update skipped (not normalizable)', { channelId, raw });
      continue;
    }

    bridgeLog.trace('Normalized inbound message', {
      channelId,
      offset: normalized.offset,
      senderId: normalized.message.senderId,
      chatType: normalized.message.chatType,
      bodyPreview: normalized.message.body.slice(0, 100),
    });

    maxOffset = Math.max(maxOffset ?? 0, normalized.offset);

    // R9: Skip duplicate messages (can happen on restart before offset is acked)
    const msgKey = `${channelId}:${normalized.message.channelMessageId ?? normalized.offset}`;
    if (trackMessageId(msgKey)) {
      bridgeLog.debug('Skipping duplicate message', { channelId, msgKey });
      continue;
    }

    // Phase 1: DM only
    if (normalized.message.chatType !== 'direct') {
      bridgeLog.debug('Skipping non-DM message', {
        channelId,
        chatType: normalized.message.chatType,
      });
      continue;
    }

    // Allowlist check — for fromMe messages, check channelChatId (the recipient
    // JID) since the sender is our own account
    const allowlistId = normalized.message.fromMe
      ? normalized.message.channelChatId
      : normalized.message.senderId;
    if (!isAllowedSender(allowlistId, config)) {
      bridgeLog.warn('Message from non-allowed sender', {
        channelId,
        senderId: normalized.message.senderId,
        allowlistId,
        fromMe: normalized.message.fromMe,
        allowedIds: config.allowedSenderIds,
      });
      continue;
    }

    hadValidMessage = true;

    // Bot command dispatch (before agent handler)
    if (channelId === 'telegram' && isBotCommand(normalized.message.body)) {
      try {
        const handled = await handleBotCommand(
          normalized.message,
          config.credentials?.botToken as string,
        );
        if (handled) continue;
      } catch (err) {
        bridgeLog.error('Bot command handler failed', { channelId, error: String(err) });
        continue;
      }
    }

    if (channelId === 'whatsapp' && isWhatsAppCommand(normalized.message.body)) {
      try {
        const handled = await handleWhatsAppCommand(normalized.message, adapter);
        if (handled) continue;
      } catch (err) {
        bridgeLog.error('WhatsApp command handler failed', { channelId, error: String(err) });
        continue;
      }
    }

    bridgeLog.debug('Dispatching to agent handler', {
      channelId,
      senderId: normalized.message.senderId,
    });

    {
      let timeoutId: ReturnType<typeof setTimeout> | undefined;
      try {
        await Promise.race([
          handleChannelMessage(normalized.message, adapter, config),
          new Promise<never>((_, reject) => {
            timeoutId = setTimeout(
              () => reject(new Error('Channel handler timeout')),
              HANDLER_TIMEOUT_MS,
            );
          }),
        ]);
      } catch (err) {
        bridgeLog.error('Agent handler failed', { channelId, error: String(err) });
      } finally {
        clearTimeout(timeoutId);
      }
    }
  }

  if (hadValidMessage) {
    await updateChannelConfig(channelId, { lastActivityAt: Date.now() });

    // Upgrade passive → active on valid message for lower latency (fire-and-forget)
    if (config.status === 'passive') {
      switchToActiveMode(channelId).catch(err => {
        bridgeLog.warn('Failed to upgrade to active mode', { channelId, error: String(err) });
      });
    }
  }

  bridgeLog.trace('handleChannelUpdates complete', { channelId, maxOffset, hadValidMessage });
  return maxOffset;
};

/** Normalize a raw channel update — returns message + channel-specific offset */
const normalizeUpdate = (
  channelId: string,
  raw: unknown,
  config?: { acceptFromMe?: boolean; acceptFromOthers?: boolean },
): NormalizedWithOffset | null => {
  switch (channelId) {
    case 'telegram':
      return normalizeTelegramUpdate(raw as TgUpdate);
    case 'whatsapp':
      return normalizeWhatsAppUpdate(raw as WaInboundUpdate, {
        acceptFromMe: config?.acceptFromMe,
        acceptFromOthers: config?.acceptFromOthers,
      });
    default:
      bridgeLog.warn('Unknown channel for normalization', { channelId });
      return null;
  }
};

export { handleChannelUpdates };
