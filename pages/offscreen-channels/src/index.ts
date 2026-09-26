import './timer-shim';

import { registerWorkerRouter } from './message-router';
import { storageProxy } from './storage-proxy';
import { diagnostics } from '@extension/shared/lib/diagnostics.js';

// ── Baileys trace forwarder ──
// Baileys library code (compiled .js) uses console.log with prefixed tags.
// These run in the offscreen document context and are invisible from the
// service worker console. Intercept them and forward via chrome.runtime so
// they appear in the unified SW log stream.
const TRACE_PREFIXES = [
  '[BAILEYS-TRACE]',
  '[SIGNAL-DEBUG]',
  '[MSG-SEND-DEBUG]',
  '[SIGNAL-STORAGE]',
  '[AUTH-UTILS-DEBUG]',
];
/* eslint-disable no-console -- Intercepts vendored Baileys logs for forwarding to the service worker. */
const _origConsoleLog = console.log.bind(console);
console.log = (...args: unknown[]) => {
  _origConsoleLog(...args);
  if (typeof args[0] === 'string') {
    const msg = args[0];
    if (TRACE_PREFIXES.some(p => msg.startsWith(p))) {
      // Fire-and-forget forward to service worker
      try {
        chrome.runtime
          .sendMessage({
            type: 'WA_DEBUG',
            channelId: 'whatsapp',
            event: 'baileys-trace',
            tag: msg,
            data: args.length > 1 ? args[1] : undefined,
          })
          .catch(() => {});
      } catch {
        /* extension context may be invalidated */
      }
    }
  }
};

/* eslint-enable no-console */

// Register the shared worker message router with the offscreen storage proxy
registerWorkerRouter(storageProxy);

diagnostics.log('[offscreen] Channel workers router initialized');
