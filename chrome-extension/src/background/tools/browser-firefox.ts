/**
 * Firefox browser tool — uses chrome.scripting + chrome.tabs instead of chrome.debugger (CDP).
 *
 * This module is lazily imported by browser.ts when IS_FIREFOX is true.
 * It implements the same BrowserArgs interface but with Firefox-compatible APIs.
 */

import { executePageAction } from './browser-page-actions';
import { sendVisualCommand } from './browser-visuals';
import { waitForPage } from './browser-wait';
import { sanitizeImage } from './image-sanitization';
import type { ScreenshotResult } from './browser';
import type { BrowserArgs } from './browser-schema';

// The `browser` global is provided by webextension-polyfill (imported in index.ts)
// or natively by Firefox. We declare it loosely here since @types/webextension-polyfill
// is not installed and `typeof chrome` doesn't include Firefox-only APIs like captureVisibleTab.
declare const browser: {
  tabs: {
    captureVisibleTab: (windowId: number, options: { format: string }) => Promise<string>;
  };
};

const visualizedTabs = new Set<number>();

const clearFirefoxSnapshot = async (tabId: number): Promise<void> => {
  visualizedTabs.delete(tabId);
  await sendVisualCommand(tabId, 'ISOLATED', 'reset');
};

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const NAVIGATE_TIMEOUT_MS = 15_000;

/** Wait for a tab to finish loading (status === 'complete'). */
const waitForTabLoad = async (tabId: number, timeoutMs = NAVIGATE_TIMEOUT_MS): Promise<void> => {
  // Check if already loaded before attaching listener (avoids race with cached pages)
  const current = await chrome.tabs.get(tabId);
  if (current.status === 'complete') return;

  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      chrome.tabs.onUpdated.removeListener(listener);
      reject(new Error('Page load timed out'));
    }, timeoutMs);

    const listener = (updatedTabId: number, changeInfo: { status?: string }) => {
      if (updatedTabId === tabId && changeInfo.status === 'complete') {
        clearTimeout(timer);
        chrome.tabs.onUpdated.removeListener(listener);
        resolve();
      }
    };
    chrome.tabs.onUpdated.addListener(listener);
  });
};

// ---------------------------------------------------------------------------
// Action handlers
// ---------------------------------------------------------------------------

const handleTabs = async (): Promise<string> => {
  const tabs = await chrome.tabs.query({ lastFocusedWindow: true });
  const lines = tabs.map(
    t => `[${t.id}] ${t.active ? '(active) ' : ''}${t.title ?? 'Untitled'} — ${t.url ?? ''}`,
  );
  return `Open tabs (${tabs.length}):\n${lines.join('\n')}`;
};

const handleOpen = async (args: BrowserArgs): Promise<string> => {
  if (!args.url) return 'Error: "url" is required for the "open" action.';
  const tab = await chrome.tabs.create({ url: args.url, active: args.active ?? false });
  return `Opened tab [${tab.id}]: ${tab.url ?? args.url}`;
};

const handleClose = async (args: BrowserArgs): Promise<string> => {
  if (args.tabId == null) return 'Error: "tabId" is required for the "close" action.';
  visualizedTabs.delete(args.tabId);
  await chrome.tabs.remove(args.tabId);
  return `Closed tab [${args.tabId}].`;
};

const handleFocus = async (args: BrowserArgs): Promise<string> => {
  if (args.tabId == null) return 'Error: "tabId" is required for the "focus" action.';
  const tab = await chrome.tabs.update(args.tabId, { active: true });
  if (tab?.windowId) {
    await chrome.windows.update(tab.windowId, { focused: true });
  }
  return `Focused tab [${args.tabId}]: ${tab?.title ?? ''}`;
};

const handleNavigate = async (args: BrowserArgs): Promise<string> => {
  if (args.tabId == null) return 'Error: "tabId" is required for the "navigate" action.';
  if (!args.url) return 'Error: "url" is required for the "navigate" action.';

  if (visualizedTabs.delete(args.tabId)) {
    await sendVisualCommand(args.tabId, 'ISOLATED', 'clear');
  }

  await chrome.tabs.update(args.tabId, { url: args.url });
  await waitForTabLoad(args.tabId);

  const tab = await chrome.tabs.get(args.tabId);
  return `Navigated tab [${args.tabId}] to ${tab.url ?? args.url}. Run "snapshot" to see page content.`;
};

const handleContent = async (args: BrowserArgs): Promise<string> => {
  if (args.tabId == null) return 'Error: "tabId" is required for the "content" action.';

  const results = await chrome.scripting.executeScript({
    target: { tabId: args.tabId },
    func: (selector?: string) => {
      if (selector) {
        const el = document.querySelector(selector);
        return el ? (el as HTMLElement).innerText : `No element found for selector: ${selector}`;
      }
      return document.body.innerText;
    },
    args: [args.selector],
  });

  let text = results?.[0]?.result ?? '';
  if (typeof text === 'string' && text.length > 50000) {
    text = text.slice(0, 50000) + '\n[truncated at 50,000 characters]';
  }
  return text;
};

const handleSnapshot = async (args: BrowserArgs): Promise<string> => {
  if (args.tabId == null) return 'Error: "tabId" is required for the "snapshot" action.';
  if (visualizedTabs.delete(args.tabId)) {
    await sendVisualCommand(args.tabId, 'ISOLATED', 'clear');
  }

  // Inject an inline DOM walker that mirrors walkNode from browser.ts
  const results = await chrome.scripting.executeScript({
    target: { tabId: args.tabId },
    func: () => {
      const INTERACTIVE_TAGS = new Set([
        'a',
        'button',
        'input',
        'select',
        'textarea',
        'details',
        'summary',
      ]);
      const INTERACTIVE_ROLES = new Set([
        'button',
        'link',
        'checkbox',
        'radio',
        'tab',
        'menuitem',
        'switch',
        'combobox',
        'searchbox',
        'slider',
        'spinbutton',
        'textbox',
        'option',
      ]);
      const SKIP_TAGS = new Set([
        'script',
        'style',
        'noscript',
        'svg',
        'meta',
        'link',
        'path',
        'defs',
        'clippath',
      ]);
      const STRUCTURAL_TAGS = new Set([
        'div',
        'span',
        'section',
        'nav',
        'main',
        'aside',
        'header',
        'footer',
        'article',
        'form',
        'fieldset',
        'legend',
        'ul',
        'ol',
        'li',
        'dl',
        'dt',
        'dd',
        'table',
        'thead',
        'tbody',
        'tfoot',
        'tr',
        'th',
        'td',
        'h1',
        'h2',
        'h3',
        'h4',
        'h5',
        'h6',
        'p',
        'blockquote',
        'pre',
        'code',
        'label',
        'dialog',
        'img',
        'video',
        'audio',
        'canvas',
        'iframe',
      ]);
      const MAX_TEXT = 80;
      const MAX_DEPTH = 40;
      const MAX_NODES = 5000;

      let refCounter = 0;
      let nodeCount = 0;
      const lines: string[] = [];
      const refs = new Map<number, Element>();

      const truncate = (text: string): string => {
        const t = text.trim().replace(/\s+/g, ' ');
        return t.length <= MAX_TEXT ? t : t.slice(0, MAX_TEXT) + '...';
      };

      const isInteractive = (el: Element): boolean => {
        const tag = el.tagName.toLowerCase();
        if (INTERACTIVE_TAGS.has(tag)) return true;
        const role = el.getAttribute('role');
        if (role && INTERACTIVE_ROLES.has(role)) return true;
        if (el.hasAttribute('onclick')) return true;
        if (el.getAttribute('contenteditable') === 'true') return true;
        const tabIndex = el.getAttribute('tabindex');
        if (tabIndex != null && Number(tabIndex) >= 0) return true;
        const cursor = getComputedStyle(el).cursor;
        const parentCursor = el.parentElement ? getComputedStyle(el.parentElement).cursor : '';
        if (cursor !== parentCursor && ['pointer', 'grab'].includes(cursor)) return true;
        return false;
      };

      const formatInteractive = (el: Element, ref: number): string => {
        const tag = el.tagName.toLowerCase();
        const parts: string[] = [`[${ref}]`];
        if (tag === 'a') parts.push('link');
        else if (tag === 'button' || el.getAttribute('role') === 'button') parts.push('button');
        else if (tag === 'input') parts.push(`input type=${el.getAttribute('type') ?? 'text'}`);
        else if (tag === 'select') parts.push('select');
        else if (tag === 'textarea') parts.push('textarea');
        else parts.push(el.getAttribute('role') ?? tag);

        const text = truncate(el.textContent ?? '');
        if (text) parts.push(`"${text}"`);

        const ariaLabel = el.getAttribute('aria-label');
        if (ariaLabel && !text) parts.push(`"${truncate(ariaLabel)}"`);

        const href = el.getAttribute('href');
        if (href) parts.push(`href=${href.length > 60 ? href.slice(0, 60) + '...' : href}`);

        return parts.join(' ');
      };

      const walk = (node: Node, depth: number): void => {
        if (nodeCount >= MAX_NODES || depth > MAX_DEPTH) return;

        if (node.nodeType === 3) {
          const text = truncate(node.textContent ?? '');
          if (text) lines.push('  '.repeat(depth) + text);
          nodeCount++;
          return;
        }

        if (node.nodeType !== 1) return;
        const el = node as Element;
        const tag = el.tagName.toLowerCase();
        if (SKIP_TAGS.has(tag) || el.hasAttribute('data-asktab-visuals')) return;
        const style = getComputedStyle(el);
        if (
          el.hasAttribute('hidden') ||
          el.hasAttribute('inert') ||
          el.getAttribute('aria-hidden') === 'true' ||
          el.hasAttribute('disabled') ||
          style.display === 'none' ||
          style.visibility === 'hidden'
        )
          return;

        nodeCount++;
        const indent = '  '.repeat(depth);

        if (isInteractive(el)) {
          const ref = ++refCounter;
          refs.set(ref, el);
          lines.push(`${indent}${formatInteractive(el, ref)}`);
          for (const child of el.shadowRoot?.childNodes ?? []) walk(child, depth + 1);
          return;
        }

        if (STRUCTURAL_TAGS.has(tag)) {
          const savedLength = lines.length;
          for (const child of el.childNodes) {
            walk(child, depth + 1);
          }
          for (const child of el.shadowRoot?.childNodes ?? []) walk(child, depth + 1);
          const newLines = lines.splice(savedLength);
          if (newLines.length > 0) {
            lines.push(`${indent}[${tag}]`);
            lines.push(...newLines);
          }
          return;
        }

        for (const child of el.childNodes) {
          walk(child, depth);
        }
        for (const child of el.shadowRoot?.childNodes ?? []) walk(child, depth);
      };

      lines.push(`[page] ${document.title} (${location.href})`);
      walk(document.body, 1);
      (globalThis as typeof globalThis & { __askTabRefs?: Map<number, Element> }).__askTabRefs =
        refs;

      if (nodeCount >= MAX_NODES) {
        lines.push(`\n[truncated: reached ${MAX_NODES} node limit]`);
      }
      return lines.join('\n');
    },
  });

  const snapshot = results?.[0]?.result ?? 'Error: Failed to capture snapshot';
  if (!snapshot.startsWith('Error:')) {
    if (await sendVisualCommand(args.tabId, 'ISOLATED', 'show')) visualizedTabs.add(args.tabId);
    else visualizedTabs.delete(args.tabId);
  }
  return snapshot;
};

// ---------------------------------------------------------------------------
// Snapshot refs are stored in the page's isolated extension world so actions
// use the captured element identity rather than re-enumerating a changing DOM.
// ---------------------------------------------------------------------------

const handleScreenshot = async (args: BrowserArgs): Promise<string | ScreenshotResult> => {
  if (args.tabId == null) return 'Error: "tabId" is required for the "screenshot" action.';

  // Ensure target tab is active (captureVisibleTab captures the active tab)
  const tab = await chrome.tabs.get(args.tabId);
  if (tab.windowId == null) return 'Error: Cannot capture screenshot — tab has no window.';
  if (!tab.active) {
    await chrome.tabs.update(args.tabId, { active: true });
  }

  // Use the polyfill's browser.tabs.captureVisibleTab (Firefox native API).
  // Fallback to chrome.tabs.captureVisibleTab for environments where the
  // polyfill didn't wrap it (e.g. certain bundling edge cases).
  const captureTab =
    browser.tabs.captureVisibleTab ??
    (chrome.tabs as unknown as { captureVisibleTab?: typeof browser.tabs.captureVisibleTab })
      .captureVisibleTab;

  if (!captureTab) {
    return 'Error: Screenshot API is not available in this browser. captureVisibleTab is not supported.';
  }

  const dataUrl = await captureTab(tab.windowId, { format: 'png' });

  // Strip data URL prefix to get base64
  const base64 = dataUrl.replace(/^data:image\/png;base64,/, '');

  // Resize, compress, and get real dimensions (matches Chrome behavior)
  let sanitized;
  try {
    sanitized = await sanitizeImage(base64, 'image/png');
  } catch {
    // Fallback: return raw PNG if sanitization fails (e.g. OffscreenCanvas unavailable)
  }

  if (sanitized) {
    return {
      __type: 'screenshot',
      base64: sanitized.base64,
      mimeType: sanitized.mimeType,
      width: sanitized.width,
      height: sanitized.height,
    };
  }

  return {
    __type: 'screenshot',
    base64,
    mimeType: 'image/png',
    width: 0,
    height: 0,
  };
};

// ---------------------------------------------------------------------------
// Main executor
// ---------------------------------------------------------------------------

const executeBrowserFirefox = async (args: BrowserArgs): Promise<string | ScreenshotResult> => {
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

  try {
    switch (args.action) {
      case 'tabs':
        return await handleTabs();
      case 'open':
        return await handleOpen(args);
      case 'close':
        return await handleClose(args);
      case 'focus':
        return await handleFocus(args);
      case 'navigate':
        return await handleNavigate(args);
      case 'content':
        return await handleContent(args);
      case 'snapshot':
        return await handleSnapshot(args);
      case 'screenshot':
        return await handleScreenshot(args);
      case 'click':
      case 'type':
      case 'select':
      case 'scroll':
        return await executePageAction(args, 'scripting');
      case 'wait':
        return await waitForPage(args.seconds);
      case 'console':
        return 'Console monitoring is unavailable on Firefox. The debugger API is not supported.';
      case 'network':
        return 'Network monitoring is unavailable on Firefox. The debugger API is not supported.';
      default:
        return `Error: Unknown action "${args.action}".`;
    }
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    return `Error: ${msg}`;
  }
};

export { clearFirefoxSnapshot, executeBrowserFirefox };
