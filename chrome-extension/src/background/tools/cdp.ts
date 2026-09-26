import { diagnostics } from '@extension/shared/lib/diagnostics.js';
// ---------------------------------------------------------------------------
// Shared CDP (Chrome DevTools Protocol) helpers
// ---------------------------------------------------------------------------

const CDP_UNAVAILABLE_MSG =
  'Chrome DevTools Protocol (chrome.debugger) is not available on Firefox. ' +
  'This operation requires CDP and cannot be performed in this browser.';

/**
 * Send a CDP command to a tab via `chrome.debugger.sendCommand`.
 * Returns a typed Promise that resolves with the command result.
 */
const cdpSend = async <T = unknown>(
  target: number | chrome.debugger.Debuggee,
  method: string,
  params?: Record<string, unknown>,
): Promise<T> => {
  if (typeof chrome.debugger === 'undefined') {
    throw new Error(CDP_UNAVAILABLE_MSG);
  }
  return new Promise((resolve, reject) => {
    chrome.debugger.sendCommand(
      typeof target === 'number' ? { tabId: target } : target,
      method,
      params ?? {},
      result => {
        if (chrome.runtime.lastError) {
          reject(new Error(chrome.runtime.lastError.message));
        } else {
          resolve(result as T);
        }
      },
    );
  });
};

/**
 * Attach the debugger to a tab or offscreen target at protocol version 1.3.
 * Returns `null` on success (including "already attached"), or an error string.
 */
const cdpAttach = async (target: number | chrome.debugger.Debuggee): Promise<string | null> => {
  if (typeof chrome.debugger === 'undefined') {
    return CDP_UNAVAILABLE_MSG;
  }
  try {
    await new Promise<void>((resolve, reject) => {
      chrome.debugger.attach(typeof target === 'number' ? { tabId: target } : target, '1.3', () => {
        if (chrome.runtime.lastError) {
          reject(new Error(chrome.runtime.lastError.message));
        } else {
          resolve();
        }
      });
    });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    if (msg.includes('Another debugger')) {
      return null;
    }
    return msg;
  }
  return null;
};

/**
 * Like cdpSend, but if the command fails with a "not attached" or "detached"
 * error, re-attaches the debugger once and retries the command.
 */
const cdpSendWithReattach = async <T = unknown>(
  tabId: number,
  method: string,
  params?: Record<string, unknown>,
): Promise<T> => {
  try {
    return await cdpSend<T>(tabId, method, params);
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    if (!msg.toLowerCase().includes('not attached') && !msg.toLowerCase().includes('detached')) {
      throw err;
    }
    // Try to re-attach and re-enable CDP domains
    diagnostics.warn(`[cdp] ${method} failed on tab ${tabId}: ${msg}. Re-attaching...`);
    const attachErr = await cdpAttach(tabId);
    if (attachErr) throw new Error(`Re-attach failed: ${attachErr}`);
    await cdpSend(tabId, 'Runtime.enable');
    await cdpSend(tabId, 'Network.enable');
    await cdpSend(tabId, 'Page.enable');
    await cdpSend(tabId, 'DOM.enable');
    diagnostics.info(`[cdp] Re-attached to tab ${tabId}, retrying ${method}`);
    return cdpSend<T>(tabId, method, params);
  }
};

export { cdpSend, cdpAttach, cdpSendWithReattach };
