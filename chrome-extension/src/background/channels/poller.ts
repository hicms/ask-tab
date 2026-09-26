import { getChannelConfig, updateChannelConfig } from './config';
import { handleChannelUpdates } from './message-bridge';
import { getUpdatesShortPoll } from './telegram/bot-api';
import { createLogger } from '../logging/logger-buffer';
import { diagnostics } from '@extension/shared/lib/diagnostics.js';

const pollerLog = createLogger('channel-poller');

const ALARM_PREFIX = 'channel-poll-';
const pollingInProgress = new Set<string>();

/** Get the alarm name for a channel's passive poll */
const getPassiveAlarmName = (channelId: string): string => `${ALARM_PREFIX}${channelId}`;

/** Handle a passive poll alarm firing — do a short poll for the channel */
const handlePassivePollAlarm = async (channelId: string): Promise<void> => {
  if (pollingInProgress.has(channelId)) {
    pollerLog.trace('Skipping poll — previous cycle still running', { channelId });
    return;
  }
  pollingInProgress.add(channelId);
  try {
    await handlePassivePollInner(channelId);
  } finally {
    pollingInProgress.delete(channelId);
  }
};

const handlePassivePollInner = async (channelId: string): Promise<void> => {
  diagnostics.log(`[channel-poller] Alarm fired for ${channelId}`);
  pollerLog.trace('Passive poll alarm fired', { channelId });

  const config = await getChannelConfig(channelId);
  if (!config || !config.enabled) {
    diagnostics.log(`[channel-poller] ${channelId} not enabled, skipping`);
    pollerLog.debug('Channel not enabled, skipping poll', { channelId, hasConfig: !!config });
    return;
  }

  // Only poll in passive or idle modes (not while offscreen is actively polling)
  if (config.status === 'active') {
    pollerLog.debug('Skipping poll — channel in active mode (offscreen polling)', { channelId });
    return;
  }

  pollerLog.trace('Poll config snapshot', {
    channelId,
    status: config.status,
    offset: config.lastPollOffset,
    allowedSenders: config.allowedSenderIds.length,
  });

  try {
    let updates: unknown[] = [];

    switch (channelId) {
      case 'telegram': {
        const token = config.credentials.botToken;
        if (!token) {
          diagnostics.warn(`[channel-poller] ${channelId}: no bot token`);
          pollerLog.warn('No bot token configured', { channelId });
          return;
        }
        // R18: Validate offset is a finite number before use
        const offset =
          typeof config.lastPollOffset === 'number' && Number.isFinite(config.lastPollOffset)
            ? config.lastPollOffset
            : undefined;
        pollerLog.trace('Calling getUpdates (short poll)', { channelId, offset });
        updates = await getUpdatesShortPoll(token, offset);
        break;
      }
      default:
        pollerLog.warn('Unknown channel for passive poll', { channelId });
        return;
    }

    diagnostics.log(`[channel-poller] ${channelId}: got ${updates.length} updates`);
    pollerLog.trace('getUpdates result', { channelId, count: updates.length, updates });

    if (updates.length > 0) {
      pollerLog.info('Passive poll got updates', { channelId, count: updates.length });

      const maxUpdateId = await handleChannelUpdates(channelId, updates);

      pollerLog.trace('Updates processed', { channelId, maxUpdateId });

      // Advance offset (monotonic — never go backwards)
      if (maxUpdateId !== undefined) {
        const freshConfig = await getChannelConfig(channelId);
        const currentOffset = freshConfig?.lastPollOffset ?? 0;
        const newOffset = maxUpdateId + 1;
        if (newOffset > currentOffset) {
          await updateChannelConfig(channelId, { lastPollOffset: newOffset });
          pollerLog.debug('Offset advanced', { channelId, newOffset });
        } else {
          pollerLog.trace('Offset not advanced (already ahead)', {
            channelId,
            newOffset,
            currentOffset,
          });
        }
      }
    }

    // Clear any previous error
    if (config.status === 'error') {
      await updateChannelConfig(channelId, { status: 'passive', lastError: undefined });
      pollerLog.info('Cleared error status', { channelId });
    }
  } catch (err) {
    const errorMsg = err instanceof Error ? err.message : String(err);
    diagnostics.error(`[channel-poller] ${channelId} error:`, errorMsg);
    pollerLog.error('Passive poll error', { channelId, error: errorMsg });

    // Set error status for persistent failures (401 = invalid token)
    if (errorMsg.includes('401') || errorMsg.includes('Unauthorized')) {
      await updateChannelConfig(channelId, { status: 'error', lastError: errorMsg });
    }
  }
};

/** Create a passive poll alarm for a channel */
const createPassiveAlarm = (channelId: string): void => {
  chrome.alarms.create(getPassiveAlarmName(channelId), { periodInMinutes: 0.5 });
  diagnostics.log(`[channel-poller] Created alarm for ${channelId} (every 30s)`);
};

/** Clear the passive poll alarm for a channel */
const clearPassiveAlarm = async (channelId: string): Promise<void> => {
  await chrome.alarms.clear(getPassiveAlarmName(channelId));
};

/** Check if an alarm name is a channel passive poll alarm */
const isChannelPollAlarm = (alarmName: string): boolean => alarmName.startsWith(ALARM_PREFIX);

/** Extract the channel ID from a poll alarm name */
const channelIdFromAlarmName = (alarmName: string): string => alarmName.slice(ALARM_PREFIX.length);

export {
  handlePassivePollAlarm,
  createPassiveAlarm,
  clearPassiveAlarm,
  isChannelPollAlarm,
  channelIdFromAlarmName,
  getPassiveAlarmName,
};
