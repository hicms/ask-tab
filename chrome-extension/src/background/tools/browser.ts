import { getFocusedWindowId, groupAgentTab, openAgentTab } from './agent-tab-group';
import { clickByRef, getBoxCenter } from './browser-click';
import { clearFirefoxSnapshot, executeBrowserFirefox } from './browser-firefox';
import { runBrowserTabAction } from './browser-lifecycle';
import { executePageAction } from './browser-page-actions';
import { browserSchema } from './browser-schema';
import {
  walkNode,
  isInteractive,
  formatInteractiveNode,
  truncateText,
  collectTextContent,
  MAX_NODES,
  MAX_DEPTH,
  MAX_TEXT_LENGTH,
  MAX_RESULT_CHARS,
} from './browser-snapshot';
import { typeByRef } from './browser-type';
import { clearSnapshotVisuals, showCdpSnapshotVisuals, sendVisualCommand } from './browser-visuals';
import { waitForPage } from './browser-wait';
import { cdpSend, cdpSendWithReattach, keepTabRendering } from './cdp';
import { sanitizeImage } from './image-sanitization';
import { injectControlIndicator, removeControlIndicator } from './tab-indicator';
import { createLogger } from '../logging/logger-buffer';
import { IS_FIREFOX } from '@extension/env';
import type { BrowserArgs } from './browser-schema';
import type { CDPNode, SnapshotContext, RefEntry } from './browser-snapshot';
import type { SanitizedImage } from './image-sanitization';
import type { ToolContext, ToolRegistration, ToolResult } from './tool-registration';

const browserLog = createLogger('browser');

/** Structured result returned by the screenshot action */
interface ScreenshotResult {
  __type: 'screenshot';
  base64: string;
  mimeType: string;
  width: number;
  height: number;
}

// ---------------------------------------------------------------------------
// Session management
// ---------------------------------------------------------------------------

interface TabSession {
  attached: boolean;
  refMap: Map<number, RefEntry>;
  snapshotBackend?: 'cdp' | 'scripting';
  consoleLogs: ConsoleEntry[];
  networkRequests: NetworkEntry[];
}

interface ConsoleEntry {
  type: string;
  text: string;
  timestamp: number;
}

interface NetworkEntry {
  method: string;
  url: string;
  status?: number;
  type?: string;
  timestamp: number;
}

const MAX_BUFFER = 200;

const sessions = new Map<number, TabSession>();

const getOrCreateSession = (tabId: number): TabSession => {
  let session = sessions.get(tabId);
  if (!session) {
    session = {
      attached: false,
      refMap: new Map(),
      consoleLogs: [],
      networkRequests: [],
    };
    sessions.set(tabId, session);
  }
  return session;
};

const cleanupSession = (tabId: number): void => {
  sessions.delete(tabId);
};

const pushToRingBuffer = <T>(buffer: T[], item: T): void => {
  buffer.push(item);
  if (buffer.length > MAX_BUFFER) {
    buffer.shift();
  }
};

// Per-tab attach promises to serialize concurrent ensureAttached calls
const attachPromises = new Map<number, Promise<string | null>>();

// Per-tab attach failure cache — prevents redundant attach attempts
interface AttachFailure {
  error: string;
  timestamp: number;
  origin: string;
}
const ATTACH_FAILURE_TTL_MS = 60_000;
const attachFailureCache = new Map<number, AttachFailure>();

/** Get the origin from a tab URL, or empty string if unavailable. */
const getTabOrigin = async (tabId: number): Promise<string> => {
  try {
    const tab = await chrome.tabs.get(tabId);
    if (tab.url) return new URL(tab.url).origin;
  } catch {
    // ignore
  }
  return '';
};

const tryAttach = async (tabId: number): Promise<string | null> => {
  const session = getOrCreateSession(tabId);
  browserLog.debug('tryAttach', { tabId });

  try {
    await new Promise<void>((resolve, reject) => {
      chrome.debugger.attach({ tabId }, '1.3', () => {
        if (chrome.runtime.lastError) {
          reject(new Error(chrome.runtime.lastError.message));
        } else {
          resolve();
        }
      });
    });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    if (msg.includes('Another debugger is already attached')) {
      browserLog.debug('Another debugger already attached, reusing', { tabId });
      session.attached = true;
      await keepTabRendering(tabId);
      return null;
    }
    browserLog.warn('Attach failed', { tabId, error: msg });
    return msg;
  }

  session.attached = true;
  attachFailureCache.delete(tabId);
  browserLog.info('Debugger attached', { tabId });

  // Enable domains — may fail if the page immediately detaches the debugger
  try {
    await cdpSend(tabId, 'Runtime.enable');
    await cdpSend(tabId, 'Network.enable');
    await cdpSend(tabId, 'Page.enable');
    await cdpSend(tabId, 'DOM.enable');
  } catch (domainErr) {
    const msg = domainErr instanceof Error ? domainErr.message : String(domainErr);
    browserLog.warn('Domain enable failed after attach — page may have detached debugger', {
      tabId,
      error: msg,
    });
    session.attached = false;
    return msg;
  }

  await keepTabRendering(tabId);
  return null;
};

const doAttach = async (tabId: number): Promise<string | null> => {
  // First attempt
  const firstErr = await tryAttach(tabId);
  if (!firstErr) return null;
  browserLog.info('First attach failed, detaching and retrying', { tabId, error: firstErr });

  // Detach and retry once — handles stale debugger state after tab reload/navigation
  try {
    await new Promise<void>(resolve => {
      chrome.debugger.detach({ tabId }, () => {
        void chrome.runtime.lastError; // consume error
        resolve();
      });
    });
    cleanupSession(tabId);
  } catch {
    // detach failed — ignore
  }

  const retryErr = await tryAttach(tabId);
  if (!retryErr) return null;

  // Both attempts failed — cache and return error
  const errorMsg = `Cannot attach debugger to this tab: ${retryErr}. This site blocks debugger access. Use browser content action or execute_javascript with tabId instead. Do NOT retry debugger for this tab.`;
  const origin = await getTabOrigin(tabId);
  attachFailureCache.set(tabId, { error: errorMsg, timestamp: Date.now(), origin });
  return errorMsg;
};

const ensureAttached = async (tabId: number): Promise<string | null> => {
  const session = getOrCreateSession(tabId);
  browserLog.trace('ensureAttached', { tabId, sessionAttached: session.attached });
  if (session.attached) {
    // Verify the connection is still alive — session.attached may be stale
    // after extension reload or if the debugger was detached externally.
    try {
      await cdpSend(tabId, 'Runtime.evaluate', { expression: '1' });
      return null;
    } catch (err) {
      // Connection is dead — reset and re-attach below
      browserLog.warn('Stale debugger session detected, re-attaching', {
        tabId,
        error: String(err),
      });
      session.attached = false;
      attachFailureCache.delete(tabId);
    }
  }

  // Check attach failure cache
  const cached = attachFailureCache.get(tabId);
  if (cached) {
    const age = Date.now() - cached.timestamp;
    if (age < ATTACH_FAILURE_TTL_MS) {
      // Check if origin has changed (tab navigated to different site)
      const currentOrigin = await getTabOrigin(tabId);
      if (currentOrigin === cached.origin || currentOrigin === '') {
        return `${cached.error} (cached — previously failed ${Math.round(age / 1000)}s ago)`;
      }
      // Origin changed, clear cache and try again
      attachFailureCache.delete(tabId);
    } else {
      // TTL expired
      attachFailureCache.delete(tabId);
    }
  }

  // Serialize concurrent attach attempts for the same tab
  const pending = attachPromises.get(tabId);
  if (pending) return pending;

  const promise = doAttach(tabId);
  attachPromises.set(tabId, promise);
  try {
    return await promise;
  } finally {
    attachPromises.delete(tabId);
  }
};

// ---------------------------------------------------------------------------
// Debugger event listeners (registered once at module load)
// Firefox does not have chrome.debugger — skip registration entirely.
// ---------------------------------------------------------------------------

if (!IS_FIREFOX) {
  chrome.debugger.onDetach.addListener((source, _reason) => {
    if (source.tabId != null) {
      attachFailureCache.delete(source.tabId);
      const session = sessions.get(source.tabId);
      if (session?.snapshotBackend === 'scripting') {
        session.attached = false;
      } else {
        cleanupSession(source.tabId);
      }
    }
  });

  chrome.debugger.onEvent.addListener((source, method, params) => {
    if (source.tabId == null) return;
    const session = sessions.get(source.tabId);
    if (!session) return;

    const p = params as Record<string, unknown>;

    if (method === 'Runtime.consoleAPICalled') {
      const args = (p.args as Array<{ type: string; value?: unknown; description?: string }>) ?? [];
      const text = args.map(a => a.description ?? a.value ?? '').join(' ');
      pushToRingBuffer(session.consoleLogs, {
        type: (p.type as string) ?? 'log',
        text,
        timestamp: Date.now(),
      });
    }

    if (method === 'Network.requestWillBeSent') {
      const request = p.request as { method?: string; url?: string } | undefined;
      if (request) {
        pushToRingBuffer(session.networkRequests, {
          method: request.method ?? 'GET',
          url: request.url ?? '',
          timestamp: Date.now(),
        });
      }
    }

    if (method === 'Network.responseReceived') {
      const response = p.response as
        | { url?: string; status?: number; mimeType?: string }
        | undefined;
      if (response) {
        // Update the last matching request with status
        for (let i = session.networkRequests.length - 1; i >= 0; i--) {
          if (
            session.networkRequests[i].url === response.url &&
            session.networkRequests[i].status == null
          ) {
            session.networkRequests[i].status = response.status;
            session.networkRequests[i].type = response.mimeType;
            break;
          }
        }
      }
    }
  });

  // Cleanup session when tab is closed
  chrome.tabs.onRemoved.addListener(tabId => {
    attachFailureCache.delete(tabId);
    if (sessions.has(tabId)) {
      try {
        chrome.debugger.detach({ tabId }, () => {
          // Ignore errors — tab is already gone
          void chrome.runtime.lastError;
        });
      } catch {
        // ignore
      }
      cleanupSession(tabId);
    }
  });
} // end if (!IS_FIREFOX)

// ---------------------------------------------------------------------------
// Wait helpers
// ---------------------------------------------------------------------------

/** Check if a URL is an SPA hash-based route. */
const isSpaHashRoute = (url: string): boolean => url.includes('#/') || url.includes('#!/');

const waitForLoad = (tabId: number, timeoutMs = 15000): Promise<void> =>
  new Promise((_resolve, reject) => {
    const resolve = _resolve;
    const timer = setTimeout(() => {
      chrome.debugger.onEvent.removeListener(listener);
      reject(new Error('Page load timed out'));
    }, timeoutMs);

    const listener = (source: chrome.debugger.Debuggee, method: string) => {
      if (
        source.tabId === tabId &&
        (method === 'Page.loadEventFired' || method === 'Page.frameStoppedLoading')
      ) {
        clearTimeout(timer);
        chrome.debugger.onEvent.removeListener(listener);
        resolve();
      }
    };
    chrome.debugger.onEvent.addListener(listener);
  });

interface CancellablePromise {
  promise: Promise<void>;
  cancel: () => void;
}

/**
 * Wait for network idle — no in-flight requests for `quietMs`, up to `maxMs` total.
 * Used for SPA navigations where load events may not fire.
 * Returns a cancellable promise to avoid listener leaks when used in Promise.race.
 */
const waitForNetworkIdle = (tabId: number, quietMs = 1000, maxMs = 10000): CancellablePromise => {
  let cleanup: (() => void) | null = null;

  const promise = new Promise<void>(resolve => {
    let inFlight = 0;
    let quietTimer: ReturnType<typeof setTimeout> | null = null;
    let cancelled = false;

    const teardown = () => {
      if (cancelled) return;
      cancelled = true;
      chrome.debugger.onEvent.removeListener(listener);
      if (quietTimer) clearTimeout(quietTimer);
      clearTimeout(maxTimer);
    };

    const done = () => {
      teardown();
      resolve();
    };

    cleanup = teardown;

    const maxTimer = setTimeout(done, maxMs);

    const checkQuiet = () => {
      if (cancelled) return;
      if (inFlight <= 0) {
        if (quietTimer) clearTimeout(quietTimer);
        quietTimer = setTimeout(done, quietMs);
      } else if (quietTimer) {
        clearTimeout(quietTimer);
        quietTimer = null;
      }
    };

    const listener = (source: chrome.debugger.Debuggee, method: string) => {
      if (cancelled || source.tabId !== tabId) return;
      if (method === 'Network.requestWillBeSent') {
        inFlight++;
        checkQuiet();
      } else if (method === 'Network.loadingFinished' || method === 'Network.loadingFailed') {
        inFlight = Math.max(0, inFlight - 1);
        checkQuiet();
      }
    };

    chrome.debugger.onEvent.addListener(listener);
    checkQuiet();
  });

  return { promise, cancel: () => cleanup?.() };
};

// ---------------------------------------------------------------------------
// Snapshot algorithm
// ---------------------------------------------------------------------------

const buildSnapshot = async (tabId: number): Promise<string> => {
  const session = getOrCreateSession(tabId);

  const { root } = await cdpSendWithReattach<{ root: CDPNode }>(tabId, 'DOM.getDocument', {
    depth: -1,
    pierce: true,
  });

  let title = '';
  let url = '';
  try {
    const tab = await chrome.tabs.get(tabId);
    title = tab.title ?? '';
    url = tab.url ?? '';
  } catch {
    // ignore
  }

  const ctx: SnapshotContext = {
    refCounter: 0,
    nodeCount: 0,
    refMap: new Map(),
    lines: [],
    unlabeledButtonRefs: new Set(),
  };

  ctx.lines.push(`[page] ${title} (${url})`);
  walkNode(root, 1, ctx);

  const buttonCenters = new Map<number, { x: number; y: number } | null>();
  await Promise.all(
    [...(ctx.unlabeledButtonRefs ?? [])].map(async ref => {
      const entry = ctx.refMap.get(ref);
      if (!entry) return;
      try {
        buttonCenters.set(ref, await getBoxCenter(tabId, entry.backendNodeId));
      } catch {
        buttonCenters.set(ref, null);
      }
    }),
  );
  ctx.lines = ctx.lines.map(line => {
    const match = /^\s*\[(\d+)\] button\b/.exec(line);
    if (!match || !buttonCenters.has(Number(match[1]))) return line;
    const center = buttonCenters.get(Number(match[1]));
    return center ? `${line} at=(${center.x},${center.y})` : `${line} at=(unavailable)`;
  });

  session.refMap = ctx.refMap;
  session.snapshotBackend = 'cdp';
  await showCdpSnapshotVisuals(tabId, ctx.refMap);

  if (ctx.nodeCount >= MAX_NODES) {
    ctx.lines.push(`\n[truncated: reached ${MAX_NODES} node limit]`);
  }

  return ctx.lines.join('\n');
};

// ---------------------------------------------------------------------------
// Action handlers
// ---------------------------------------------------------------------------

const ensureTabActive = async (tabId: number): Promise<void> => {
  await chrome.tabs.update(tabId, { active: true });
};

const handleTabs = async (): Promise<string> => {
  // Scope discovery to the user's currently focused window only. The agent
  // attaches the debugger per tabId returned here, so limiting the listing to
  // the focused window prevents cross-window debugger attachment.
  const tabs = await chrome.tabs.query({ lastFocusedWindow: true });
  // Build a map of group ID → group info for annotation. Chrome: tabGroups API;
  // may be unavailable in Firefox or if permission missing — fail silently.
  const groupMap = new Map<number, chrome.tabGroups.TabGroup>();
  try {
    if (chrome.tabGroups?.query) {
      const groups = await chrome.tabGroups.query({});
      for (const g of groups) groupMap.set(g.id, g);
    }
  } catch {
    // ignore — tab groups not supported on this browser
  }
  const lines = tabs.map(t => {
    const base = `[${t.id}] ${t.active ? '(active) ' : ''}${t.title ?? 'Untitled'} — ${t.url ?? ''}`;
    const gid = (t as chrome.tabs.Tab).groupId;
    if (gid != null && gid !== -1) {
      const g = groupMap.get(gid);
      if (g) return `${base} [group: "${g.title ?? ''}" ${g.color}]`;
      return `${base} [group: ${gid}]`;
    }
    return base;
  });
  return `Open tabs (${tabs.length}):\n${lines.join('\n')}`;
};

const handleOpen = async (args: BrowserArgs, chatId?: string): Promise<string> => {
  if (!args.url) return 'Error: "url" is required for the "open" action.';
  const props = { url: args.url, active: args.active ?? false };
  const tab =
    args.groupId != null ? await chrome.tabs.create(props) : await openAgentTab(chatId, props);
  // Store the new tab ID so the caller can use it (e.g. for indicator highlight)
  if (tab.id != null) (args as Record<string, unknown>).tabId = tab.id;

  // Attach while the page loads so a background tab keeps rendering.
  if (tab.id != null) {
    const attachErr = await ensureAttached(tab.id);
    if (attachErr) {
      browserLog.info('handleOpen: attach failed, page may not render in the background', {
        tabId: tab.id,
        error: attachErr,
      });
      // The tab was mid-navigation; let the next page action retry attaching.
      attachFailureCache.delete(tab.id);
    }
  }

  // Optionally add the new tab to an existing group
  if (args.groupId != null && tab.id != null) {
    try {
      await chrome.tabs.group({ tabIds: [tab.id], groupId: args.groupId });
      const group = await chrome.tabGroups.get(args.groupId);
      return `Opened tab [${tab.id}]: ${tab.url ?? args.url} → added to group [${args.groupId}] "${group.title || '(untitled)'}"`;
    } catch {
      return `Opened tab [${tab.id}]: ${tab.url ?? args.url} (warning: failed to add to group ${args.groupId})`;
    }
  }

  return `Opened tab [${tab.id}]: ${tab.url ?? args.url}`;
};

const handleFocus = async (args: BrowserArgs): Promise<string> => {
  if (args.tabId == null) return 'Error: "tabId" is required for the "focus" action.';
  const tab = await chrome.tabs.update(args.tabId, { active: true });
  if (tab?.windowId) {
    await chrome.windows.update(tab.windowId, { focused: true });
  }
  return `Focused tab [${args.tabId}]: ${tab?.title ?? ''}`;
};

const handleClose = async (args: BrowserArgs): Promise<string> => {
  if (args.tabId == null) return 'Error: "tabId" is required for the "close" action.';
  // Detach debugger if attached
  const session = sessions.get(args.tabId);
  if (session?.attached) {
    try {
      await new Promise<void>(resolve => {
        chrome.debugger.detach({ tabId: args.tabId! }, () => {
          void chrome.runtime.lastError;
          resolve();
        });
      });
    } catch {
      // ignore
    }
  }
  cleanupSession(args.tabId);
  await chrome.tabs.remove(args.tabId);
  return `Closed tab [${args.tabId}].`;
};

const handleNavigate = async (args: BrowserArgs): Promise<string> => {
  if (args.tabId == null) return 'Error: "tabId" is required for the "navigate" action.';
  if (!args.url) return 'Error: "url" is required for the "navigate" action.';

  if (args.active) {
    await ensureTabActive(args.tabId);
  }

  const navSession = getOrCreateSession(args.tabId);
  await clearSnapshotVisuals(args.tabId, navSession.snapshotBackend);
  navSession.refMap.clear();
  navSession.snapshotBackend = undefined;

  // Clear attach failure cache — navigation to new page may succeed
  attachFailureCache.delete(args.tabId);

  // Try debugger-based navigation first for full load detection;
  // fall back to chrome.tabs.update for pages that block debugger access.
  browserLog.debug('handleNavigate: attaching', { tabId: args.tabId, url: args.url });
  const attachErr = await ensureAttached(args.tabId);
  if (attachErr) {
    browserLog.info('handleNavigate: attach failed, falling back to tabs API', {
      tabId: args.tabId,
      error: attachErr,
    });
    await chrome.tabs.update(args.tabId, { url: args.url });
    await new Promise(resolve => setTimeout(resolve, 2000));
    const tab = await chrome.tabs.get(args.tabId);
    return `Navigated tab [${args.tabId}] to ${tab.url ?? args.url}. Run "snapshot" to see page content.`;
  }

  browserLog.debug('handleNavigate: using CDP Page.navigate', { tabId: args.tabId });
  const spaNav = isSpaHashRoute(args.url);
  const loadTimeout = spaNav ? 20000 : 15000;
  const loadPromise = waitForLoad(args.tabId, loadTimeout);
  const navResult = await cdpSendWithReattach<{ frameId?: string; errorText?: string }>(
    args.tabId,
    'Page.navigate',
    { url: args.url },
  );

  // Check for navigation-level errors (e.g., invalid URL, DNS failure)
  if (navResult.errorText) {
    return `Error: Navigation failed — ${navResult.errorText}`;
  }

  if (spaNav) {
    // SPA hash navigations may not fire Page.loadEventFired — race with network idle
    const networkIdle = waitForNetworkIdle(args.tabId);
    await Promise.race([loadPromise, networkIdle.promise]);
    networkIdle.cancel();
  } else {
    await loadPromise;
  }

  const tab = await chrome.tabs.get(args.tabId);
  return `Navigated tab [${args.tabId}] to ${tab.url ?? args.url}. Run "snapshot" to see page content.`;
};

const handleContent = async (args: BrowserArgs): Promise<string> => {
  if (args.tabId == null) return 'Error: "tabId" is required for the "content" action.';

  browserLog.debug('handleContent: executing script', {
    tabId: args.tabId,
    selector: args.selector ?? null,
  });
  const results = await chrome.scripting.executeScript({
    target: { tabId: args.tabId },
    func: (selector: string | null) => {
      if (selector) {
        const el = document.querySelector(selector);
        return el ? (el as HTMLElement).innerText : `No element found for selector: ${selector}`;
      }
      return document.body.innerText;
    },
    args: [typeof args.selector === 'string' ? args.selector : null],
  });

  let text = results?.[0]?.result ?? '';
  if (typeof text === 'string' && text.length > 50000) {
    text = text.slice(0, 50000) + '\n[truncated at 50,000 characters]';
  }
  return text;
};

const handleSnapshot = async (args: BrowserArgs): Promise<string> => {
  if (args.tabId == null) return 'Error: "tabId" is required for the "snapshot" action.';
  const session = getOrCreateSession(args.tabId);
  await clearSnapshotVisuals(args.tabId, session.snapshotBackend);
  session.refMap.clear();
  session.snapshotBackend = undefined;

  browserLog.debug('handleSnapshot: attaching', { tabId: args.tabId });
  const attachErr = await ensureAttached(args.tabId);
  if (attachErr) {
    browserLog.warn('handleSnapshot: CDP attach failed, falling back to scripting snapshot', {
      tabId: args.tabId,
      error: attachErr,
    });

    const fallback = await executeBrowserFirefox({ ...args, action: 'snapshot' });
    if (typeof fallback === 'string' && !fallback.startsWith('Error:')) {
      getOrCreateSession(args.tabId).snapshotBackend = 'scripting';
      return fallback;
    }
    return `Error: Cannot capture this page. Detail: ${attachErr}`;
  }

  browserLog.debug('handleSnapshot: building snapshot', { tabId: args.tabId });
  let snapshot: string;
  try {
    snapshot = await buildSnapshot(args.tabId);
  } catch (snapshotErr) {
    // Debugger may have been immediately detached — fall back to scripting snapshot
    const msg = snapshotErr instanceof Error ? snapshotErr.message : String(snapshotErr);
    browserLog.warn('handleSnapshot: buildSnapshot failed, falling back to scripting snapshot', {
      tabId: args.tabId,
      error: msg,
    });

    const fallback = await executeBrowserFirefox({ ...args, action: 'snapshot' });
    if (typeof fallback === 'string' && !fallback.startsWith('Error:')) {
      getOrCreateSession(args.tabId).snapshotBackend = 'scripting';
      return fallback;
    }
    return `Error: Cannot capture this page. Detail: ${msg}`;
  }

  if (snapshot.length < 200) {
    snapshot +=
      '\n\n[Note: This page returned very little visible content. The site may be blocking content extraction. Consider asking the user to describe the page content instead.]';
  }

  // Truncate oversized snapshots
  if (snapshot.length > MAX_RESULT_CHARS) {
    snapshot =
      snapshot.slice(0, MAX_RESULT_CHARS) +
      '\n\n[Snapshot truncated at 30000 chars. Use content with a selector, or execute_javascript with tabId, to extract targeted data.]';
  }

  return snapshot;
};

const handleScreenshot = async (args: BrowserArgs): Promise<string | ScreenshotResult> => {
  if (args.tabId == null) return 'Error: "tabId" is required for the "screenshot" action.';

  const attachErr = await ensureAttached(args.tabId);
  if (attachErr) {
    return `Error: Cannot capture this page — the site blocks programmatic access (common with Google, banking, and enterprise apps). Detail: ${attachErr}. Try using execute_javascript with tabId to run JS in the page context instead, or ask the user to describe what they see.`;
  }

  const params: Record<string, unknown> = { format: 'png' };

  if (args.fullPage) {
    // Get full page metrics
    const metrics = await cdpSendWithReattach<{
      contentSize: { width: number; height: number };
    }>(args.tabId, 'Page.getLayoutMetrics');
    const { width, height } = metrics.contentSize;

    await cdpSendWithReattach(args.tabId, 'Emulation.setDeviceMetricsOverride', {
      width: Math.ceil(width),
      height: Math.ceil(height),
      deviceScaleFactor: 1,
      mobile: false,
    });

    params.captureBeyondViewport = true;
  }

  try {
    const result = await cdpSendWithReattach<{ data: string }>(
      args.tabId,
      'Page.captureScreenshot',
      params,
    );

    // Resize and compress the screenshot
    let sanitized: SanitizedImage | null;
    try {
      sanitized = await sanitizeImage(result.data, 'image/png');
    } catch {
      // Fallback: return raw PNG if sanitization fails (e.g. OffscreenCanvas unavailable)
      return JSON.stringify({ base64: result.data, mimeType: 'image/png' });
    }
    if (!sanitized) {
      return JSON.stringify({ base64: result.data, mimeType: 'image/png' });
    }

    return {
      __type: 'screenshot',
      base64: sanitized.base64,
      mimeType: sanitized.mimeType,
      width: sanitized.width,
      height: sanitized.height,
    };
  } finally {
    if (args.fullPage) {
      await cdpSendWithReattach(args.tabId, 'Emulation.clearDeviceMetricsOverride');
    }
  }
};

const handleClick = async (args: BrowserArgs): Promise<string> => {
  if (args.tabId == null) return 'Error: "tabId" is required for the "click" action.';
  if (args.ref == null) return 'Error: "ref" is required for the "click" action.';
  const session = getOrCreateSession(args.tabId);
  if (session.snapshotBackend === 'scripting') {
    return executeBrowserFirefox(args) as Promise<string>;
  }
  const attachErr = await ensureAttached(args.tabId);
  if (attachErr) return `Error: ${attachErr}`;
  const entry = getOrCreateSession(args.tabId).refMap.get(args.ref);
  if (!entry) return `Error: Ref [${args.ref}] not found. Run "snapshot" to refresh refs.`;
  return clickByRef(args.tabId, args.ref, entry);
};

const handleType = async (args: BrowserArgs): Promise<string> => {
  if (args.tabId == null) return 'Error: "tabId" is required for the "type" action.';
  if (args.ref == null) return 'Error: "ref" is required for the "type" action.';
  if (args.text === undefined) return 'Error: "text" is required for the "type" action.';
  if (getOrCreateSession(args.tabId).snapshotBackend === 'scripting') {
    return executeBrowserFirefox(args) as Promise<string>;
  }

  const attachErr = await ensureAttached(args.tabId);
  if (attachErr) return `Error: ${attachErr}`;

  const session = getOrCreateSession(args.tabId);
  const entry = session.refMap.get(args.ref);
  if (!entry) return `Error: Ref [${args.ref}] not found. Run "snapshot" to refresh refs.`;
  return typeByRef(args.tabId, args.ref, entry, args.text);
};

const handleConsole = async (args: BrowserArgs): Promise<string> => {
  if (args.tabId == null) return 'Error: "tabId" is required for the "console" action.';
  const session = sessions.get(args.tabId);
  if (!session) return 'No console data. Debugger may not be attached to this tab.';

  const limit = args.limit ?? 50;
  const entries = session.consoleLogs.slice(-limit);
  if (entries.length === 0) return 'No console messages captured.';

  const lines = entries.map(e => `[${e.type}] ${e.text}`);
  return `Console messages (${entries.length}):\n${lines.join('\n')}`;
};

const handleNetwork = async (args: BrowserArgs): Promise<string> => {
  if (args.tabId == null) return 'Error: "tabId" is required for the "network" action.';
  const session = sessions.get(args.tabId);
  if (!session) return 'No network data. Debugger may not be attached to this tab.';

  const limit = args.limit ?? 50;
  const entries = session.networkRequests.slice(-limit);
  if (entries.length === 0) return 'No network requests captured.';

  const lines = entries.map(e =>
    `${e.method} ${e.url} ${e.status != null ? `→ ${e.status}` : '(pending)'} ${e.type ?? ''}`.trim(),
  );
  return `Network requests (${entries.length}):\n${lines.join('\n')}`;
};

// ---------------------------------------------------------------------------
// Tab group handlers
// ---------------------------------------------------------------------------

const resolveTabIds = (args: BrowserArgs): number[] | null => {
  if (args.tabIds && args.tabIds.length > 0) return args.tabIds;
  if (args.tabId != null) return [args.tabId];
  return null;
};

// Partition the requested tabIds into those belonging to the focused window and
// those in other windows. chrome.tabs.group() physically moves cross-window tabs
// into a single window as a side effect, so we filter them out to keep the user's
// other windows intact. If the focused window cannot be resolved, no filtering is
// applied (returns all as in-window) to avoid breaking single-window usage.
const partitionByFocusedWindow = async (
  tabIds: number[],
): Promise<{ inWindow: number[]; crossWindow: number[] }> => {
  const focusedWindowId = await getFocusedWindowId();
  if (focusedWindowId == null) return { inWindow: tabIds, crossWindow: [] };
  const inWindow: number[] = [];
  const crossWindow: number[] = [];
  await Promise.all(
    tabIds.map(async id => {
      try {
        const tab = await chrome.tabs.get(id);
        if (tab.windowId === focusedWindowId) inWindow.push(id);
        else crossWindow.push(id);
      } catch {
        // Tab no longer exists — drop it (neither in-window nor actionable).
      }
    }),
  );
  return { inWindow, crossWindow };
};

// Trailing note appended to a success message listing tabs skipped because they
// live in other windows. Empty string when nothing was skipped.
const formatSkipped = (crossWindow: number[]): string =>
  crossWindow.length > 0
    ? ` Skipped ${crossWindow.length} tab(s) in other windows: ${crossWindow.join(', ')}.`
    : '';

// Error returned when none of the requested tabs are in the focused window.
const noTabsInWindowError = (crossWindow: number[]): string =>
  `Error: none of the requested tab(s) are in the current window${
    crossWindow.length > 0
      ? ` (skipped ${crossWindow.length} tab(s) in other windows: ${crossWindow.join(', ')})`
      : ''
  }.`;

const handleGroupTabs = async (args: BrowserArgs): Promise<string> => {
  const requestedTabIds = resolveTabIds(args);
  if (!requestedTabIds) {
    return 'Error: "tabIds" (or "tabId") is required for the "group_tabs" action.';
  }
  // chrome.tabs.group() moves cross-window tabs into one window as a side effect.
  // Filter to the focused window so other windows' tabs are never pulled in.
  const { inWindow: tabIds, crossWindow } = await partitionByFocusedWindow(requestedTabIds);
  if (tabIds.length === 0) {
    return noTabsInWindowError(crossWindow);
  }
  try {
    const groupOptions: chrome.tabs.GroupOptions = { tabIds };
    if (args.groupId != null) groupOptions.groupId = args.groupId;
    const groupId = await chrome.tabs.group(groupOptions);
    if (args.title != null || args.color != null) {
      const updateProps: chrome.tabGroups.UpdateProperties = {};
      if (args.title != null) updateProps.title = args.title;
      if (args.color != null) updateProps.color = args.color;
      await chrome.tabGroups.update(groupId, updateProps);
    }
    return `Grouped ${tabIds.length} tab(s) into group [${groupId}]${args.title ? ` "${args.title}"` : ''}${args.color ? ` (${args.color})` : ''}.${formatSkipped(crossWindow)}`;
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    return `Error grouping tabs: ${msg}`;
  }
};

const handleUngroupTabs = async (args: BrowserArgs): Promise<string> => {
  const requestedTabIds = resolveTabIds(args);
  if (!requestedTabIds) {
    return 'Error: "tabIds" (or "tabId") is required for the "ungroup_tabs" action.';
  }
  // Unlike group(), ungroup() does NOT move tabs across windows, so there is no
  // side-effect to prevent here. We still scope to the focused window as an
  // intentional policy: the agent should only manipulate the user's current
  // window and never reach into groups in other windows.
  const { inWindow: tabIds, crossWindow } = await partitionByFocusedWindow(requestedTabIds);
  if (tabIds.length === 0) {
    return noTabsInWindowError(crossWindow);
  }
  try {
    await chrome.tabs.ungroup(tabIds);
    return `Ungrouped ${tabIds.length} tab(s).${formatSkipped(crossWindow)}`;
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    return `Error ungrouping tabs: ${msg}`;
  }
};

const handleListTabGroups = async (): Promise<string> => {
  try {
    // Scope to the focused window so the agent cannot obtain groupIds from other
    // windows (which it could otherwise feed back into group_tabs).
    const focusedWindowId = await getFocusedWindowId();
    const query: chrome.tabGroups.QueryInfo =
      focusedWindowId != null ? { windowId: focusedWindowId } : {};
    const groups = await chrome.tabGroups.query(query);
    if (groups.length === 0) return 'No tab groups.';
    const lines = groups.map(
      g => `[${g.id}] "${g.title ?? ''}" — ${g.color}${g.collapsed ? ' (collapsed)' : ''}`,
    );
    return `Tab groups (${groups.length}):\n${lines.join('\n')}`;
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    return `Error listing tab groups: ${msg}`;
  }
};

const handleUpdateTabGroup = async (args: BrowserArgs): Promise<string> => {
  if (args.groupId == null) {
    return 'Error: "groupId" is required for the "update_tab_group" action.';
  }
  const updateProps: chrome.tabGroups.UpdateProperties = {};
  if (args.title != null) updateProps.title = args.title;
  if (args.color != null) updateProps.color = args.color;
  if (args.collapsed != null) updateProps.collapsed = args.collapsed;
  if (Object.keys(updateProps).length === 0) {
    return 'Error: at least one of "title", "color", or "collapsed" is required for the "update_tab_group" action.';
  }
  try {
    const group = await chrome.tabGroups.update(args.groupId, updateProps);
    if (!group) {
      return `Updated tab group [${args.groupId}].`;
    }
    return `Updated tab group [${group.id}]: "${group.title ?? ''}" — ${group.color}${group.collapsed ? ' (collapsed)' : ''}.`;
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    return `Error updating tab group: ${msg}`;
  }
};

// ---------------------------------------------------------------------------
// Main executor
// ---------------------------------------------------------------------------

const executeBrowser = async (
  args: BrowserArgs,
  context?: ToolContext,
): Promise<string | ScreenshotResult> => {
  if (args.action === 'wait') return waitForPage(args.seconds, context?.signal);
  browserLog.debug('executeBrowser', { action: args.action, tabId: args.tabId });
  // Coerce tabId/ref to numbers — LLMs sometimes emit string values and the
  // browser extension CSP prevents AJV type coercion from running.
  if (args.tabId != null && typeof args.tabId !== 'number') {
    (args as Record<string, unknown>).tabId = Number(args.tabId);
    if (Number.isNaN(args.tabId)) (args as Record<string, unknown>).tabId = undefined;
  }
  if (args.ref != null && typeof args.ref !== 'number') {
    (args as Record<string, unknown>).ref = Number(args.ref);
    if (Number.isNaN(args.ref)) (args as Record<string, unknown>).ref = undefined;
  }
  if (args.groupId != null && typeof args.groupId !== 'number') {
    (args as Record<string, unknown>).groupId = Number(args.groupId);
    if (Number.isNaN(args.groupId)) (args as Record<string, unknown>).groupId = undefined;
  }
  if (Array.isArray(args.tabIds)) {
    (args as Record<string, unknown>).tabIds = args.tabIds
      .map(id => (typeof id === 'number' ? id : Number(id)))
      .filter((id): id is number => typeof id === 'number' && !Number.isNaN(id));
  }

  return runBrowserTabAction(
    args,
    context?.signal,
    () => executeBrowserAction(args, context?.chatId),
    async tabId => {
      const session = sessions.get(tabId);
      session?.refMap.clear();
      if (session) session.snapshotBackend = undefined;
      await Promise.all([sendVisualCommand(tabId, 'MAIN', 'reset'), clearFirefoxSnapshot(tabId)]);
    },
  );
};

const executeBrowserAction = async (
  args: BrowserArgs,
  chatId?: string,
): Promise<string | ScreenshotResult> => {
  const isTabGroupAction =
    args.action === 'group_tabs' ||
    args.action === 'ungroup_tabs' ||
    args.action === 'list_tab_groups' ||
    args.action === 'update_tab_group';

  // Firefox: no chrome.tabGroups support — return a clear error for tab group actions
  if (IS_FIREFOX && isTabGroupAction) {
    return `Error: The "${args.action}" action is not supported on Firefox (chrome.tabGroups is Chrome-only).`;
  }

  // Firefox: delegate to scripting-based implementation (no chrome.debugger)
  if (IS_FIREFOX) {
    return executeBrowserFirefox(args);
  }

  // Visual indicator — highlight the tab while the tool is executing
  const noHighlight = args.action === 'tabs' || args.action === 'close' || isTabGroupAction;
  let indicatorTabId: number | undefined = !noHighlight ? (args.tabId ?? undefined) : undefined;

  if (indicatorTabId != null) {
    if (args.action !== 'open') await groupAgentTab(chatId, indicatorTabId);
    await injectControlIndicator(indicatorTabId);
  }

  try {
    let result: string | ScreenshotResult;
    switch (args.action) {
      case 'tabs':
        result = await handleTabs();
        break;
      case 'open':
        result = await handleOpen(args, chatId);
        break;
      case 'focus':
        result = await handleFocus(args);
        break;
      case 'close':
        result = await handleClose(args);
        break;
      case 'navigate':
        result = await handleNavigate(args);
        break;
      case 'content':
        result = await handleContent(args);
        break;
      case 'snapshot':
        result = await handleSnapshot(args);
        break;
      case 'screenshot':
        result = await handleScreenshot(args);
        break;
      case 'click':
        result = await handleClick(args);
        break;
      case 'type':
        result = await handleType(args);
        break;
      case 'select':
      case 'scroll': {
        const session = args.tabId == null ? undefined : sessions.get(args.tabId);
        result = await executePageAction(
          args,
          session?.snapshotBackend ?? 'cdp',
          session?.refMap.get(args.ref ?? -1),
        );
        break;
      }
      case 'console':
        result = await handleConsole(args);
        break;
      case 'network':
        result = await handleNetwork(args);
        break;
      case 'group_tabs':
        result = await handleGroupTabs(args);
        break;
      case 'ungroup_tabs':
        result = await handleUngroupTabs(args);
        break;
      case 'list_tab_groups':
        result = await handleListTabGroups();
        break;
      case 'update_tab_group':
        result = await handleUpdateTabGroup(args);
        break;
      default:
        result = `Error: Unknown action "${args.action}".`;
    }

    // For 'open', highlight the newly created tab (handleOpen sets args.tabId)
    if (!noHighlight && args.action === 'open' && !indicatorTabId && args.tabId != null) {
      indicatorTabId = args.tabId;
      await injectControlIndicator(indicatorTabId);
    }

    return result;
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    browserLog.error('executeBrowser error', {
      action: args.action,
      tabId: args.tabId,
      error: msg,
    });

    // If the error is debugger-related, fall back to the Firefox (scripting-based) implementation
    // which works on any page without CDP.
    const isDebuggerError =
      msg.toLowerCase().includes('not attached') ||
      msg.toLowerCase().includes('detached') ||
      msg.toLowerCase().includes('debugger') ||
      msg.toLowerCase().includes('cannot attach');
    if (isDebuggerError && !['click', 'type', 'select', 'scroll'].includes(args.action)) {
      browserLog.info('Falling back to scripting-based implementation', {
        action: args.action,
        tabId: args.tabId,
      });
      try {
        const fallback = await executeBrowserFirefox(args);
        if (typeof fallback === 'string' && fallback.startsWith('Error:')) {
          return fallback;
        }
        return fallback;
      } catch (fallbackErr) {
        const fallbackMsg =
          fallbackErr instanceof Error ? fallbackErr.message : String(fallbackErr);
        browserLog.error('Scripting fallback also failed', {
          action: args.action,
          error: fallbackMsg,
        });
        return `Error: ${msg}. Scripting fallback also failed: ${fallbackMsg}`;
      }
    }

    return `Error: ${msg}`;
  } finally {
    // Remove visual indicator after tool execution completes
    if (indicatorTabId != null) {
      removeControlIndicator(indicatorTabId).catch(() => {});
    }
  }
};

const browserToolDef: ToolRegistration = {
  name: 'browser',
  label: 'Browser',
  description:
    'Control browser tabs: list/open/close/focus, navigate, snapshot numbered element refs, screenshot, click/type/select by ref, scroll up/down/left/right (optional ref targets its nearest scrollable ancestor), wait for page updates, console/network logs, and tab groups. Take a snapshot before interacting, and refresh it after page changes. Type replaces text; an empty string clears it. Select uses an exact native option label (text) or value. Use execute_javascript with tabId for page scripts. Task completion automatically removes page markers.',
  schema: browserSchema,
  needsContext: true,
  execute: (args, context) => executeBrowser(args as BrowserArgs, context),
  formatResult: (raw): ToolResult => {
    if (typeof raw === 'object' && (raw as ScreenshotResult).__type === 'screenshot') {
      const ss = raw as ScreenshotResult;
      return {
        content: [
          { type: 'text', text: `Screenshot captured (${ss.width}\u00d7${ss.height})` },
          { type: 'image', data: ss.base64, mimeType: ss.mimeType },
        ],
        details: { width: ss.width, height: ss.height },
      };
    }
    return { content: [{ type: 'text', text: raw as string }], details: { output: raw } };
  },
};

export { browserToolDef };

// Export internals for testing
export {
  browserSchema,
  executeBrowser,
  sessions,
  getOrCreateSession,
  cleanupSession,
  walkNode,
  buildSnapshot,
  isInteractive,
  formatInteractiveNode,
  truncateText,
  collectTextContent,
  MAX_BUFFER,
  MAX_NODES,
  MAX_DEPTH,
  MAX_TEXT_LENGTH,
  MAX_RESULT_CHARS,
  attachFailureCache,
  ATTACH_FAILURE_TTL_MS,
  isSpaHashRoute,
};
export type {
  BrowserArgs,
  ScreenshotResult,
  TabSession,
  CDPNode,
  SnapshotContext,
  RefEntry,
  ConsoleEntry,
  NetworkEntry,
};
