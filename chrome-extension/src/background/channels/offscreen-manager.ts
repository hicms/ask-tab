import { getChannelConfig, getChannelConfigs, updateChannelConfig } from './config';
import { handleChannelUpdates } from './message-bridge';
import { createPassiveAlarm, clearPassiveAlarm } from './poller';
import { createLogger } from '../logging/logger-buffer';
import { IS_FIREFOX } from '@extension/env';

const offscreenLog = createLogger('offscreen-mgr');

const OFFSCREEN_URL = 'offscreen-channels/index.html';
const WATCHDOG_ALARM = 'channel-watchdog';
const INACTIVITY_TIMEOUT_MS = 10 * 60 * 1000; // 10 minutes

// ---------------------------------------------------------------------------
// Offscreen Backend interface
// ---------------------------------------------------------------------------

interface OffscreenBackend {
  ensure(): Promise<void>;
  isAlive(): Promise<boolean>;
  close(): Promise<void>;
}

// ---------------------------------------------------------------------------
// Chrome backend — uses chrome.offscreen API
// ---------------------------------------------------------------------------

const chromeBackend: OffscreenBackend = {
  async ensure() {
    const exists = await chrome.offscreen.hasDocument();
    if (exists) return;

    await chrome.offscreen.createDocument({
      url: chrome.runtime.getURL(OFFSCREEN_URL),
      reasons: [chrome.offscreen.Reason.WORKERS],
      justification: 'Long-poll connection for channel messaging (Telegram, etc.)',
    });
    offscreenLog.info('Offscreen document created');
  },
  async isAlive() {
    return chrome.offscreen.hasDocument();
  },
  async close() {
    const exists = await chrome.offscreen.hasDocument();
    if (exists) {
      await chrome.offscreen.closeDocument();
      offscreenLog.info('Offscreen document closed');
    }
  },
};

// ---------------------------------------------------------------------------
// Firefox backend — uses a hidden popup window to host the worker page
// (Firefox has no chrome.offscreen API but background pages are persistent)
// ---------------------------------------------------------------------------

let firefoxWindowId: number | null = null;

const firefoxBackend: OffscreenBackend = {
  async ensure() {
    // Check if the hidden window is still alive
    if (firefoxWindowId != null) {
      try {
        await chrome.windows.get(firefoxWindowId);
        return; // still alive
      } catch {
        firefoxWindowId = null; // window was closed
      }
    }

    const url = chrome.runtime.getURL(OFFSCREEN_URL);
    const win = await chrome.windows.create({
      url,
      type: 'popup',
      state: 'minimized',
      width: 1,
      height: 1,
    });
    firefoxWindowId = win.id ?? null;
    offscreenLog.info('Firefox: hidden worker window created', { windowId: firefoxWindowId });
  },
  async isAlive() {
    if (firefoxWindowId == null) return false;
    try {
      await chrome.windows.get(firefoxWindowId);
      return true;
    } catch {
      firefoxWindowId = null;
      return false;
    }
  },
  async close() {
    if (firefoxWindowId != null) {
      try {
        await chrome.windows.remove(firefoxWindowId);
        offscreenLog.info('Firefox: hidden worker window closed', { windowId: firefoxWindowId });
      } catch {
        // window already gone
      }
      firefoxWindowId = null;
    }
  },
};

// ---------------------------------------------------------------------------
// Select backend once at module load
// ---------------------------------------------------------------------------

const backend: OffscreenBackend = IS_FIREFOX ? firefoxBackend : chromeBackend;

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/** Ensure the shared offscreen document / worker router exists */
const ensureOffscreenDocument = async (): Promise<void> => {
  await backend.ensure();
};

/** Close the offscreen document if no channels need it */
const maybeCloseOffscreenDocument = async (): Promise<void> => {
  const configs = await getChannelConfigs();
  const hasActive = configs.some(c => c.status === 'active');
  if (hasActive) return;

  await backend.close();
  await chrome.alarms.clear(WATCHDOG_ALARM);
};

/**
 * Send CHANNEL_START_WORKER to the offscreen document, retrying if the document's
 * script hasn't registered its onMessage listener yet (returns undefined).
 */
const sendStartWorker = async (
  channelId: string,
  offset: number | undefined,
  maxAttempts = 5,
): Promise<void> => {
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      const response = await chrome.runtime.sendMessage({
        type: 'CHANNEL_START_WORKER',
        channelId,
        offset,
      });
      if (response && typeof response === 'object' && (response as Record<string, unknown>).ok) {
        offscreenLog.info('CHANNEL_START_WORKER acknowledged', { channelId, attempt });
        return;
      }
      offscreenLog.debug('CHANNEL_START_WORKER not acknowledged, retrying', {
        channelId,
        attempt,
        response,
      });
    } catch {
      offscreenLog.debug('CHANNEL_START_WORKER send failed, retrying', { channelId, attempt });
    }
    // Wait before retry — offscreen document script may still be loading
    await new Promise(r => setTimeout(r, attempt * 200));
  }
  offscreenLog.warn('CHANNEL_START_WORKER not acknowledged after retries', {
    channelId,
    maxAttempts,
  });
};

/** Switch a channel to active mode (offscreen long-polling) */
const switchToActiveMode = async (channelId: string): Promise<void> => {
  const config = await getChannelConfig(channelId);
  if (!config || !config.enabled) return;

  offscreenLog.info('Switching to active mode', { channelId });
  offscreenLog.trace('Active mode config', {
    channelId,
    offset: config.lastPollOffset,
    status: config.status,
  });

  // 1. Clear passive alarm
  await clearPassiveAlarm(channelId);

  // 2. Ensure offscreen document exists
  await ensureOffscreenDocument();

  // 3. Diagnostic: verify declarativeNetRequest rules are loaded (WhatsApp)
  if (channelId === 'whatsapp') {
    try {
      const rules = await chrome.declarativeNetRequest.getSessionRules();
      const dynamicRules = await chrome.declarativeNetRequest.getDynamicRules();
      offscreenLog.info('declarativeNetRequest diagnostic', {
        sessionRulesCount: rules.length,
        dynamicRulesCount: dynamicRules.length,
      });
      // Guard testMatchOutcome — not available on Firefox
      if (typeof chrome.declarativeNetRequest.testMatchOutcome === 'function') {
        const testResult = await chrome.declarativeNetRequest.testMatchOutcome({
          url: 'wss://web.whatsapp.com/ws/chat',
          type: 'websocket' as chrome.declarativeNetRequest.ResourceType,
          initiator: `chrome-extension://${chrome.runtime.id}`,
        });
        offscreenLog.info('declarativeNetRequest testMatchOutcome for WS', {
          matchedRules: testResult.matchedRules,
        });
      }
    } catch (err) {
      offscreenLog.warn('declarativeNetRequest diagnostic failed', { error: String(err) });
    }
  }

  // 4. Send start message with retry — offscreen script may still be loading
  await sendStartWorker(channelId, config.lastPollOffset);

  // 5. Create watchdog alarm (shared across all active channels)
  chrome.alarms.create(WATCHDOG_ALARM, { periodInMinutes: 1 });

  // 6. Update status
  await updateChannelConfig(channelId, {
    status: 'active',
    lastActivityAt: Date.now(),
  });
};

/** Switch a channel to passive mode (alarm-based short-polling) */
const switchToPassiveMode = async (channelId: string): Promise<void> => {
  offscreenLog.info('Switching to passive mode', { channelId });

  // 1. Tell offscreen to stop this channel's worker
  try {
    await chrome.runtime.sendMessage({
      type: 'CHANNEL_STOP_WORKER',
      channelId,
    });
  } catch {
    // Offscreen may already be gone
  }

  // 2. Close offscreen if no other active channels
  await maybeCloseOffscreenDocument();

  // 3. Re-create passive alarm
  createPassiveAlarm(channelId);

  // 4. Update status
  await updateChannelConfig(channelId, { status: 'passive' });
};

/** Channels that require a persistent connection and must never be downgraded to passive */
const ALWAYS_ACTIVE_CHANNELS = new Set(['whatsapp']);

/** Handle the watchdog alarm — check inactivity and offscreen health */
const handleWatchdogAlarm = async (): Promise<void> => {
  const configs = await getChannelConfigs();
  const now = Date.now();
  const downgraded = new Set<string>();

  for (const config of configs) {
    if (config.status !== 'active') continue;

    // Skip channels that require persistent connections (e.g. WhatsApp WebSocket)
    if (ALWAYS_ACTIVE_CHANNELS.has(config.channelId)) continue;

    const lastActivity = config.lastActivityAt ?? 0;
    if (now - lastActivity > INACTIVITY_TIMEOUT_MS) {
      offscreenLog.info('Inactivity timeout, downgrading to passive', {
        channelId: config.channelId,
      });
      await switchToPassiveMode(config.channelId);
      downgraded.add(config.channelId);
      continue;
    }
  }

  // F11: Re-read configs after downgrades to get fresh status values
  const freshConfigs = downgraded.size > 0 ? await getChannelConfigs() : configs;
  const hasActiveChannels = freshConfigs.some(c => c.status === 'active');

  if (hasActiveChannels) {
    const alive = await backend.isAlive();
    if (!alive) {
      offscreenLog.warn('Offscreen document missing during active mode, re-creating');
      for (const config of freshConfigs) {
        if (config.status === 'active') {
          await switchToActiveMode(config.channelId);
        }
      }
    }
  }
};

/** F10: Handle messages from the offscreen document with runtime validation */
const handleOffscreenMessage = async (message: Record<string, unknown>): Promise<void> => {
  const type = message.type;
  if (typeof type !== 'string') return;

  switch (type) {
    case 'CHANNEL_UPDATES': {
      const channelId = message.channelId;
      const updates = message.updates;
      if (typeof channelId !== 'string' || !Array.isArray(updates)) {
        offscreenLog.warn('Malformed CHANNEL_UPDATES message', { message });
        return;
      }

      offscreenLog.trace('Received CHANNEL_UPDATES from offscreen', {
        channelId,
        count: updates.length,
      });
      const maxUpdateId = await handleChannelUpdates(channelId, updates);

      // Ack offset back to offscreen so it advances its local pointer
      if (maxUpdateId !== undefined) {
        await updateChannelConfig(channelId, { lastPollOffset: maxUpdateId + 1 });

        try {
          await chrome.runtime.sendMessage({
            type: 'CHANNEL_ACK_OFFSET',
            channelId,
            offset: maxUpdateId + 1,
          });
        } catch {
          // Offscreen may be gone
        }
      }
      break;
    }

    case 'CHANNEL_ERROR': {
      const channelId = message.channelId;
      const error = message.error;
      const retryable = message.retryable;
      if (typeof channelId !== 'string' || typeof error !== 'string') {
        offscreenLog.warn('Malformed CHANNEL_ERROR message', { message });
        return;
      }

      offscreenLog.trace('Received CHANNEL_ERROR from offscreen', { channelId, error, retryable });
      offscreenLog.error('Channel worker error', { channelId, error, retryable });

      if (!retryable) {
        await updateChannelConfig(channelId, { status: 'error', lastError: error });
        await maybeCloseOffscreenDocument();
      }
      break;
    }

    // WhatsApp diagnostics: log to service worker for unified visibility
    case 'WA_DEBUG': {
      const { type: _type, ...debugPayload } = message;
      offscreenLog.info('WA offscreen diagnostic', debugPayload);
      break;
    }

    // WhatsApp-specific messages: forward to UI (Options page, side panel)
    case 'WA_QR_CODE':
    case 'WA_CONNECTION_STATUS': {
      offscreenLog.info('Forwarding to UI pages', {
        type,
        status: message.status,
        statusCode: message.statusCode,
      });
      try {
        chrome.runtime.sendMessage(message).catch(err => {
          offscreenLog.debug('Broadcast had no listeners', { type, error: String(err) });
        });
      } catch {
        // No listeners
      }

      // Also update config status for connection changes
      if (type === 'WA_CONNECTION_STATUS') {
        const status = message.status as string;
        if (status === 'connected') {
          await updateChannelConfig('whatsapp', {
            status: 'active',
            lastActivityAt: Date.now(),
          });
        } else if (status === 'logged_out') {
          await updateChannelConfig('whatsapp', {
            status: 'error',
            lastError: 'Logged out — re-scan QR code to reconnect',
          });
        }
      }
      break;
    }
  }
};

const isWatchdogAlarm = (alarmName: string): boolean => alarmName === WATCHDOG_ALARM;

export {
  switchToActiveMode,
  switchToPassiveMode,
  handleWatchdogAlarm,
  handleOffscreenMessage,
  isWatchdogAlarm,
  ensureOffscreenDocument,
  maybeCloseOffscreenDocument,
  WATCHDOG_ALARM,
};
