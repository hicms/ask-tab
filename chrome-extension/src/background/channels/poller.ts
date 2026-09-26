import { ackUpdates, pullUpdates } from './gateway';
import { handleQueuedUpdate } from './message-bridge';
import { AskServiceError } from '../ask-service/client';
import { createLogger } from '../logging/logger-buffer';
import { createKeepAliveManager } from '../utils/keep-alive';
import type { QueuedUpdate } from './gateway';

const pollerLog = createLogger('channel-poller');

const CHANNEL_POLL_ALARM = 'channel-poll';
const POLL_ALARM_PERIOD_MINUTES = 0.5;
/** Pull wait while idle; the alarm provides the cadence. */
const IDLE_WAIT_SECONDS = 5;
/** Long-poll wait during a conversation. */
const ACTIVE_WAIT_SECONDS = 20;
/** Keep long-polling this long after the last valid message. */
const ACTIVE_WINDOW_MS = 5 * 60_000;

const pollKeepAlive = createKeepAliveManager('channel-poll-keep-alive');
pollKeepAlive.clearOrphan();

let currentLoop: Promise<void> | null = null;
let currentController: AbortController | null = null;
let lastMessageAt = 0;

const isActiveWindow = (): boolean => Date.now() - lastMessageAt < ACTIVE_WINDOW_MS;

const handleItem = async (item: QueuedUpdate): Promise<void> => {
  try {
    if (await handleQueuedUpdate(item)) lastMessageAt = Date.now();
  } catch (err) {
    // Acked anyway: a message that always throws would otherwise be redelivered forever.
    pollerLog.error('Queued update handling failed', {
      id: item.id,
      channelId: item.channel,
      error: String(err),
    });
  }
  try {
    await ackUpdates([item.id]);
  } catch (err) {
    pollerLog.warn('Ack failed; the server will redeliver after the lease', {
      id: item.id,
      error: String(err),
    });
  }
};

const pollLoop = async (signal: AbortSignal): Promise<void> => {
  let keptAlive = false;
  try {
    while (!signal.aborted) {
      const active = isActiveWindow();
      if (active && !keptAlive) {
        pollKeepAlive.acquire();
        keptAlive = true;
      }

      let items: QueuedUpdate[];
      try {
        items = await pullUpdates(active ? ACTIVE_WAIT_SECONDS : IDLE_WAIT_SECONDS, signal);
      } catch (err) {
        if (signal.aborted) return;
        if (err instanceof AskServiceError && err.status === 401) {
          pollerLog.debug('Not signed in; stopping channel polling');
          await stopChannelPolling();
          return;
        }
        pollerLog.warn('Channel pull failed', { error: String(err) });
        return;
      }

      for (const item of items) {
        if (signal.aborted) return;
        await handleItem(item);
      }

      if (items.length === 0 && !isActiveWindow()) return;
    }
  } finally {
    if (keptAlive) pollKeepAlive.release();
  }
};

/** Run one poll cycle, or join the one already running. */
const runPollCycle = (): Promise<void> => {
  if (currentLoop) {
    // A stopped loop may still be finishing its current message; start after it.
    return currentController?.signal.aborted ? currentLoop.then(runPollCycle) : currentLoop;
  }
  const controller = new AbortController();
  currentController = controller;
  const loop = pollLoop(controller.signal).finally(() => {
    if (currentLoop === loop) {
      currentLoop = null;
      currentController = null;
    }
  });
  currentLoop = loop;
  return loop;
};

/** Poll while at least one server channel is enabled; stop otherwise. */
const setChannelPolling = async (enabled: boolean): Promise<void> => {
  if (!enabled) {
    await stopChannelPolling();
    return;
  }
  const existing = await chrome.alarms.get(CHANNEL_POLL_ALARM);
  if (!existing) {
    await chrome.alarms.create(CHANNEL_POLL_ALARM, { periodInMinutes: POLL_ALARM_PERIOD_MINUTES });
  }
  void runPollCycle();
};

const stopChannelPolling = async (): Promise<void> => {
  currentController?.abort();
  await chrome.alarms.clear(CHANNEL_POLL_ALARM);
};

const isChannelPollAlarm = (alarmName: string): boolean => alarmName === CHANNEL_POLL_ALARM;

export {
  runPollCycle,
  setChannelPolling,
  stopChannelPolling,
  isChannelPollAlarm,
  CHANNEL_POLL_ALARM,
};
