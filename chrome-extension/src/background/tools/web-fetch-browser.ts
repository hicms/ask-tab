import type { WebFetchResult } from './web-fetch';

const PAGE_LOAD_TIMEOUT_MS = 15_000;

const waitForTabLoad = (tabId: number, timeoutMs = PAGE_LOAD_TIMEOUT_MS): Promise<void> =>
  new Promise<void>((resolve, reject) => {
    let settled = false;
    const settle = (fn: () => void) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      chrome.tabs.onUpdated.removeListener(listener);
      fn();
    };
    const timer = setTimeout(
      () => settle(() => reject(new Error(`Tab load timed out after ${timeoutMs}ms`))),
      timeoutMs,
    );
    const listener = (id: number, info: chrome.tabs.TabChangeInfo) => {
      if (id === tabId && info.status === 'complete') settle(resolve);
    };
    chrome.tabs.onUpdated.addListener(listener);
    chrome.tabs
      .get(tabId)
      .then(tab => {
        if (tab.status === 'complete') settle(resolve);
      })
      .catch(() => {
        /* A closed tab is handled by the timeout. */
      });
  });

const fetchViaBrowserPage = async (
  url: string,
  extractMode: 'text' | 'html',
  maxChars: number,
): Promise<WebFetchResult> => {
  let tabId: number | undefined;
  let createdTab = false;
  try {
    const parsedUrl = new URL(url);
    if (parsedUrl.protocol !== 'http:' && parsedUrl.protocol !== 'https:') {
      throw new Error(`Unsupported browser navigation protocol: ${parsedUrl.protocol}`);
    }

    const openTabs = await chrome.tabs.query({});
    const inIncognitoContext = chrome.extension?.inIncognitoContext ?? false;
    const matchingTabs = openTabs.filter(
      candidate =>
        candidate.url === parsedUrl.href &&
        candidate.id != null &&
        candidate.incognito === inIncognitoContext,
    );
    const existingTab = matchingTabs.find(candidate => candidate.active) ?? matchingTabs[0];
    const tab = existingTab ?? (await chrome.tabs.create({ url, active: false }));
    createdTab = existingTab == null;
    tabId = tab.id;
    if (tabId == null) throw new Error('Could not create a browser tab.');

    if (tab.status !== 'complete') await waitForTabLoad(tabId);
    const results = await chrome.scripting.executeScript({
      target: { tabId },
      func: mode => {
        const navigation = performance.getEntriesByType('navigation')[0] as
          | PerformanceNavigationTiming
          | undefined;
        return {
          text:
            mode === 'html'
              ? (document.documentElement?.outerHTML ?? '')
              : (document.body?.innerText ?? ''),
          title: document.title,
          status: navigation?.responseStatus ?? 0,
          mimeType: document.contentType,
        };
      },
      args: [extractMode],
    });
    const page = results?.[0]?.result;
    if (!page) throw new Error('Could not read the loaded page.');

    const result: WebFetchResult = {
      text: page.text.slice(0, maxChars),
      title: page.title || undefined,
      status: page.status,
      mimeType: page.mimeType,
      browserFallback: true,
    };
    if (page.status >= 400) result.error = `HTTP ${page.status}`;
    if (page.status === 0) result.error = 'Could not determine the page HTTP status.';
    return result;
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    return {
      text: '',
      status: 0,
      error: `Browser page fetch failed: ${message}`,
      browserFallback: true,
    };
  } finally {
    if (createdTab && tabId != null) {
      try {
        await chrome.tabs.remove(tabId);
      } catch {
        /* The user may have closed the temporary tab. */
      }
    }
  }
};

export { fetchViaBrowserPage, waitForTabLoad };
