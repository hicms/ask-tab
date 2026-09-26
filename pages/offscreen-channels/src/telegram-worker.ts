import { diagnostics } from '@extension/shared/lib/diagnostics.js';

const TG_API_BASE = 'https://api.telegram.org';

let abortController: AbortController | null = null;
let currentOffset: number | undefined;
let isRunning = false;
let loopPromise: Promise<void> | null = null;

// F20: Minimal type for getUpdates response (offscreen can't import from chrome-extension package)
interface TgGetUpdatesResult {
  ok: boolean;
  result?: Array<{ update_id: number; [key: string]: unknown }>;
  description?: string;
  parameters?: { retry_after?: number };
}

// R13: Validate bot token format before use in URLs
const BOT_TOKEN_RE = /^\d+:[A-Za-z0-9_-]+$/;

/** Start the Telegram long-poll loop, awaiting any previous loop exit */
const startTelegramWorker = async (botToken: string, initialOffset?: number): Promise<void> => {
  // R13: Reject malformed tokens that could cause URL injection
  if (!BOT_TOKEN_RE.test(botToken)) {
    await trySendError('Invalid bot token format', false);
    return;
  }

  if (isRunning) {
    diagnostics.warn('[tg-worker] Already running, stopping first');
    stopTelegramWorker();
    if (loopPromise) {
      await loopPromise.catch(() => {});
      loopPromise = null;
    }
  }

  currentOffset = initialOffset;
  isRunning = true;
  abortController = new AbortController();

  diagnostics.log('[tg-worker] Starting long-poll loop');
  loopPromise = pollLoop(botToken, abortController.signal);
};

/** Stop the Telegram long-poll loop */
const stopTelegramWorker = (): void => {
  isRunning = false;
  if (abortController) {
    abortController.abort();
    abortController = null;
  }
  diagnostics.log('[tg-worker] Stopped');
};

/** Update the offset (called when SW acks processed updates) */
const updateTelegramOffset = (offset: number): void => {
  currentOffset = offset;
};

/** F8: Strip bot token from error messages to avoid leaking it in logs */
const sanitizeError = (msg: string, botToken: string): string =>
  msg.replaceAll(botToken, '<REDACTED>');

/** Main long-poll loop */
const pollLoop = async (botToken: string, signal: AbortSignal): Promise<void> => {
  while (isRunning && !signal.aborted) {
    try {
      const params = new URLSearchParams({
        timeout: '25',
        allowed_updates: JSON.stringify(['message']),
      });
      if (currentOffset !== undefined) {
        params.set('offset', String(currentOffset));
      }

      const response = await fetch(`${TG_API_BASE}/bot${botToken}/getUpdates?${params}`, {
        signal,
      });

      if (!response.ok) {
        if (response.status === 409) {
          diagnostics.warn('[tg-worker] 409 Conflict, waiting 5s');
          await delay(5000, signal);
          continue;
        }

        if (response.status === 401) {
          await trySendError('Bot token is invalid (401 Unauthorized)', false);
          isRunning = false;
          return;
        }

        if (response.status === 429) {
          const body = (await response.json().catch(() => ({}))) as TgGetUpdatesResult;
          const retryAfter = body.parameters?.retry_after ?? 5;
          diagnostics.warn(`[tg-worker] Rate limited, waiting ${retryAfter}s`);
          await delay(retryAfter * 1000, signal);
          continue;
        }

        diagnostics.error(`[tg-worker] getUpdates error: ${response.status}`);
        await delay(5000, signal);
        continue;
      }

      const data = (await response.json()) as TgGetUpdatesResult;
      if (!data.ok || !data.result) {
        await delay(1000, signal);
        continue;
      }

      if (data.result.length > 0) {
        // F4: Do NOT advance offset locally — wait for SW ack via updateTelegramOffset.
        // This ensures no messages are lost if the SW crashes before processing.
        try {
          await chrome.runtime.sendMessage({
            type: 'CHANNEL_UPDATES',
            channelId: 'telegram',
            updates: data.result,
          });
        } catch (err) {
          // F14: Handle sendMessage failure (SW may be inactive)
          diagnostics.warn('[tg-worker] Failed to forward updates to SW:', err);
        }
      }
    } catch (err) {
      if (signal.aborted) return;

      // F8: Sanitize token from error messages
      const rawMsg = err instanceof Error ? err.message : String(err);
      const msg = sanitizeError(rawMsg, botToken);
      diagnostics.error('[tg-worker] Poll error:', msg);

      await trySendError(msg, true);
      await delay(5000, signal);
    }
  }
};

/** F14: Send error to SW with error handling */
const trySendError = async (error: string, retryable: boolean): Promise<void> => {
  try {
    await chrome.runtime.sendMessage({
      type: 'CHANNEL_ERROR',
      channelId: 'telegram',
      error,
      retryable,
    });
  } catch {
    diagnostics.warn('[tg-worker] Failed to send error to SW');
  }
};

const delay = (ms: number, signal?: AbortSignal): Promise<void> =>
  new Promise((resolve, reject) => {
    // F6b: Early return if already aborted
    if (signal?.aborted) {
      reject(new DOMException('Aborted', 'AbortError'));
      return;
    }
    const timer = setTimeout(resolve, ms);
    signal?.addEventListener(
      'abort',
      () => {
        clearTimeout(timer);
        reject(new DOMException('Aborted', 'AbortError'));
      },
      { once: true },
    );
  });

export { startTelegramWorker, stopTelegramWorker, updateTelegramOffset };
