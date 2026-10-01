import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// Chrome API mocks must exist BEFORE the module under test is imported.
const mockTabsCreate = vi.fn<() => Promise<Pick<chrome.tabs.Tab, 'id'>>>(() =>
  Promise.resolve({ id: 99 }),
);
const mockTabsGet = vi.fn((_tabId: number) =>
  Promise.resolve({ id: _tabId, title: 'Fallback Page', status: 'loading' }),
);
const mockTabsQuery = vi.fn<() => Promise<chrome.tabs.Tab[]>>(() => Promise.resolve([]));
const mockTabsRemove = vi.fn(() => Promise.resolve());
const mockOnUpdatedAddListener = vi.fn();
const mockOnUpdatedRemoveListener = vi.fn();
const mockExecuteScript = vi.fn<(injection?: unknown) => Promise<Array<{ result: unknown }>>>();

const pageResult = (overrides: Record<string, unknown> = {}) => ({
  text: 'Extracted page text content from browser fallback.',
  title: 'Fallback Page',
  status: 200,
  mimeType: 'text/html',
  ...overrides,
});

/** `onUpdated.addListener` fires `{ status: 'complete' }` via setTimeout(0) unless skipped. */
const setupTabMocks = (opts?: { skipTabComplete?: boolean; tabStatus?: string }) => {
  mockTabsCreate.mockReset();
  mockTabsCreate.mockImplementation(() => Promise.resolve({ id: 99 }));
  mockTabsGet.mockReset();
  mockTabsGet.mockImplementation((_tabId: number) =>
    Promise.resolve({ id: _tabId, title: 'Fallback Page', status: opts?.tabStatus ?? 'loading' }),
  );
  mockTabsRemove.mockReset();
  mockTabsRemove.mockImplementation(() => Promise.resolve());
  mockTabsQuery.mockReset();
  mockTabsQuery.mockImplementation(() => Promise.resolve([]));
  mockOnUpdatedAddListener.mockReset();
  if (!opts?.skipTabComplete) {
    mockOnUpdatedAddListener.mockImplementation(
      (fn: (tabId: number, info: { status?: string }) => void) => {
        setTimeout(() => fn(99, { status: 'complete' }), 0);
      },
    );
  }
  mockOnUpdatedRemoveListener.mockReset();
  mockExecuteScript.mockReset();
  mockExecuteScript.mockImplementation(() => Promise.resolve([{ result: pageResult() }]));
};

Object.defineProperty(globalThis, 'chrome', {
  value: {
    tabs: {
      create: mockTabsCreate,
      get: mockTabsGet,
      query: mockTabsQuery,
      remove: mockTabsRemove,
      onUpdated: {
        addListener: mockOnUpdatedAddListener,
        removeListener: mockOnUpdatedRemoveListener,
      },
    },
    scripting: { executeScript: mockExecuteScript },
  },
  writable: true,
  configurable: true,
});

vi.mock('../../chrome-extension/src/background/tools/web-shared', () => ({
  normalizeCacheKey: vi.fn((key: string) => key),
  readCache: vi.fn(() => null),
  readResponseText: vi.fn(async (res: Response) => res.text()),
  writeCache: vi.fn(),
  withTimeout: vi.fn(() => AbortSignal.timeout(30000)),
}));

vi.mock('../../chrome-extension/src/background/logging/logger-buffer', () => ({
  createLogger: () => ({
    trace: vi.fn(),
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  }),
}));

const { executeWebFetch, executeBrowserAwareWebFetch, FETCH_CACHE } = await import(
  '../../chrome-extension/src/background/tools/web-fetch'
);
const { readCache, writeCache } = await import(
  '../../chrome-extension/src/background/tools/web-shared'
);

const resetCacheMocks = () => {
  FETCH_CACHE.clear();
  vi.mocked(readCache).mockReset();
  vi.mocked(readCache).mockReturnValue(null);
  vi.mocked(writeCache).mockClear();
};

const networkFailure = () =>
  vi.mocked(globalThis.fetch).mockRejectedValue(new TypeError('Failed to fetch'));

describe('web_fetch browser page routing', () => {
  beforeEach(() => {
    globalThis.fetch = vi.fn();
    setupTabMocks();
    mockExecuteScript.mockResolvedValue([
      {
        result: {
          text: 'Signed in as Alice',
          title: 'Account',
          status: 200,
          mimeType: 'text/html',
        },
      },
    ]);
  });

  it('loads ordinary GET in a browser tab and does not cache the login state', async () => {
    const args = { url: 'https://example.com/account' };
    const first = await executeBrowserAwareWebFetch(args);
    const second = await executeBrowserAwareWebFetch(args);

    expect(first).toMatchObject({ text: 'Signed in as Alice', status: 200, browserFallback: true });
    expect(second).toMatchObject({ text: 'Signed in as Alice', status: 200 });
    expect(mockTabsCreate).toHaveBeenCalledTimes(2);
    expect(mockTabsCreate).toHaveBeenCalledWith({ url: args.url, active: false });
    expect(mockTabsRemove).toHaveBeenCalledTimes(2);
    expect(globalThis.fetch).not.toHaveBeenCalled();
  });

  it('preserves the page HTTP error status and closes its temporary tab', async () => {
    mockExecuteScript.mockResolvedValueOnce([
      { result: { text: 'Not found', title: 'Missing', status: 404, mimeType: 'text/html' } },
    ]);

    const result = await executeBrowserAwareWebFetch({ url: 'https://example.com/missing' });
    expect(result).toMatchObject({ text: 'Not found', status: 404, error: 'HTTP 404' });
    expect(mockTabsRemove).toHaveBeenCalledWith(99);
  });

  it('reads an already open page without replacing or closing the user tab', async () => {
    mockTabsQuery.mockResolvedValueOnce([
      {
        id: 7,
        url: 'https://example.com/account',
        status: 'complete',
        active: true,
        incognito: false,
      } as chrome.tabs.Tab,
    ]);

    const result = await executeBrowserAwareWebFetch({ url: 'https://example.com/account' });
    expect(result.text).toBe('Signed in as Alice');
    expect(mockTabsCreate).not.toHaveBeenCalled();
    expect(mockTabsRemove).not.toHaveBeenCalled();
    expect(mockExecuteScript).toHaveBeenCalledWith(
      expect.objectContaining({ target: { tabId: 7 } }),
    );
  });

  it('keeps custom-header requests on the programmable fetch path', async () => {
    resetCacheMocks();
    vi.mocked(globalThis.fetch).mockResolvedValue({
      ok: true,
      status: 200,
      statusText: 'OK',
      text: async () => '<title>API</title><body>Private response content</body>',
    } as Response);

    await executeBrowserAwareWebFetch({
      url: 'https://example.com/api',
      headers: { Authorization: 'Bearer test' },
    });
    expect(globalThis.fetch).toHaveBeenCalledOnce();
    expect(mockTabsCreate).not.toHaveBeenCalled();
    expect(readCache).not.toHaveBeenCalled();
    expect(writeCache).not.toHaveBeenCalled();
  });

  it('does not open a tab for a Chrome-restricted domain', async () => {
    const result = await executeBrowserAwareWebFetch({
      url: 'https://chromewebstore.google.com/detail/example',
    });

    expect(mockTabsCreate).not.toHaveBeenCalled();
    expect(mockExecuteScript).not.toHaveBeenCalled();
    expect(result).toMatchObject({ text: '', status: 0, browserFallback: true });
    expect(result.error).toContain('Chrome-restricted domain');
  });
});

describe('executeWebFetch — browser tab fallback', () => {
  beforeEach(() => {
    globalThis.fetch = vi.fn();
    setupTabMocks();
    resetCacheMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('returns fallback content on network failure for a GET text request', async () => {
    networkFailure();

    const result = await executeWebFetch({ url: 'https://network-error.example.com' });

    expect(result.browserFallback).toBe(true);
    expect(result.text).toBe('Extracted page text content from browser fallback.');
    expect(result.status).toBe(200);
  });

  // ── Trigger conditions ──

  it('CORS error opens a background tab and closes it afterwards', async () => {
    networkFailure();

    const result = await executeWebFetch({ url: 'https://cors-blocked.example.com' });

    expect(result.browserFallback).toBe(true);
    expect(result.text).toBe('Extracted page text content from browser fallback.');
    expect(mockTabsCreate).toHaveBeenCalledWith({
      url: 'https://cors-blocked.example.com',
      active: false,
    });
    expect(mockTabsRemove).toHaveBeenCalledWith(99);
  });

  it('html mode returns the page HTML', async () => {
    networkFailure();
    mockExecuteScript.mockResolvedValue([
      { result: pageResult({ text: '<html><body>Raw page</body></html>' }) },
    ]);

    const result = await executeWebFetch({
      url: 'https://cors-blocked.example.com',
      extractMode: 'html',
    });

    expect(mockExecuteScript).toHaveBeenCalledWith(expect.objectContaining({ args: ['html'] }));
    expect(result.text).toBe('<html><body>Raw page</body></html>');
  });

  it('timeout does NOT trigger fallback', async () => {
    vi.mocked(globalThis.fetch).mockRejectedValue(
      new DOMException('The operation was aborted', 'AbortError'),
    );

    const result = await executeWebFetch({ url: 'https://slow.example.com' });

    expect(result.error).toContain('timed out');
    expect(mockTabsCreate).not.toHaveBeenCalled();
    expect(result.browserFallback).toBeUndefined();
  });

  it('POST does NOT trigger fallback', async () => {
    networkFailure();

    const result = await executeWebFetch({
      url: 'https://api.example.com',
      method: 'POST',
      body: '{}',
    });

    expect(mockTabsCreate).not.toHaveBeenCalled();
    expect(result.error).toContain('Network error');
    expect(result.error).toContain('browser tool');
    expect(result.browserFallback).toBeUndefined();
  });

  it('binary mode does NOT trigger fallback', async () => {
    networkFailure();

    const result = await executeWebFetch({
      url: 'https://example.com/image.png',
      extractMode: 'binary',
    });

    expect(mockTabsCreate).not.toHaveBeenCalled();
    expect(result.error).toContain('Network error');
    expect(result.browserFallback).toBeUndefined();
  });

  // ── URL guards ──

  it.each(['chrome://settings', 'file:///etc/passwd'])('blocks non-http(s) URL %s', async url => {
    networkFailure();

    const result = await executeWebFetch({ url });

    expect(result.browserFallback).toBe(true);
    expect(result.text).toBe('');
    expect(result.error).toContain('Unsupported browser navigation protocol');
    expect(mockTabsCreate).not.toHaveBeenCalled();
  });

  it('does not open a tab for a Chrome-restricted domain', async () => {
    networkFailure();

    const result = await executeWebFetch({ url: 'https://chromewebstore.google.com/detail/x' });

    expect(mockTabsCreate).not.toHaveBeenCalled();
    expect(result.browserFallback).toBe(true);
    expect(result.error).toContain('Browser fallback also failed');
    expect(result.error).toContain('Chrome-restricted domain');
  });

  // ── Tab lifecycle ──

  it('tab is always closed even when extraction fails', async () => {
    networkFailure();
    mockExecuteScript.mockRejectedValue(new Error('Script injection failed'));

    const result = await executeWebFetch({ url: 'https://cors-blocked.example.com' });

    expect(result.browserFallback).toBe(true);
    expect(result.text).toBe('');
    expect(result.error).toContain('Browser page fetch failed');
    expect(mockTabsRemove).toHaveBeenCalledWith(99);
  });

  it('reuses an already open tab and does not close it', async () => {
    networkFailure();
    mockTabsQuery.mockResolvedValueOnce([
      {
        id: 7,
        url: 'https://cors-blocked.example.com/',
        status: 'complete',
        active: false,
        incognito: false,
      } as chrome.tabs.Tab,
    ]);

    const result = await executeWebFetch({ url: 'https://cors-blocked.example.com' });

    expect(result.text).toBe('Extracted page text content from browser fallback.');
    expect(mockTabsCreate).not.toHaveBeenCalled();
    expect(mockTabsRemove).not.toHaveBeenCalled();
    expect(mockExecuteScript).toHaveBeenCalledWith(
      expect.objectContaining({ target: { tabId: 7 } }),
    );
  });

  it('returns an error when tab creation returns no id', async () => {
    networkFailure();
    mockTabsCreate.mockImplementation(() =>
      Promise.resolve({ id: undefined } as unknown as chrome.tabs.Tab),
    );

    const result = await executeWebFetch({ url: 'https://cors-blocked.example.com' });

    expect(result.browserFallback).toBe(true);
    expect(result.text).toBe('');
    expect(result.error).toContain('Could not create a browser tab.');
  });

  it('resolves when the tab is already complete before the onUpdated listener fires', async () => {
    networkFailure();
    setupTabMocks({ skipTabComplete: true, tabStatus: 'complete' });

    const result = await executeWebFetch({ url: 'https://fast-page.example.com' });

    expect(result.text).toBe('Extracted page text content from browser fallback.');
    expect(result.status).toBe(200);
  });

  it('returns an error when the tab load times out', async () => {
    vi.useFakeTimers();
    try {
      networkFailure();
      setupTabMocks({ skipTabComplete: true, tabStatus: 'loading' });

      const promise = executeWebFetch({ url: 'https://hanging-page.example.com' });
      await vi.advanceTimersByTimeAsync(16_000);
      const result = await promise;

      expect(result.text).toBe('');
      expect(result.error).toContain('Browser fallback also failed');
      expect(result.error).toContain('timed out');
      expect(mockTabsRemove).toHaveBeenCalledWith(99);
    } finally {
      vi.useRealTimers();
    }
  });

  // ── Content and status handling ──

  it('respects maxChars', async () => {
    networkFailure();
    mockExecuteScript.mockResolvedValue([{ result: pageResult({ text: 'A'.repeat(500) }) }]);

    const result = await executeWebFetch({
      url: 'https://cors-blocked.example.com',
      maxChars: 100,
    });

    expect(result.text).toHaveLength(100);
  });

  it('treats a missing page result as a failed fallback', async () => {
    networkFailure();
    mockExecuteScript.mockResolvedValue([{ result: null }]);

    const result = await executeWebFetch({ url: 'https://error-page.example.com' });

    expect(result.browserFallback).toBe(true);
    expect(result.text).toBe('');
    expect(result.error).toContain('Browser fallback also failed');
  });

  it('returns the real HTTP status with an error and does not cache an HTTP 404', async () => {
    networkFailure();
    mockExecuteScript.mockResolvedValue([
      { result: pageResult({ text: 'Not found', status: 404 }) },
    ]);

    const result = await executeWebFetch({ url: 'https://missing.example.com' });

    expect(result).toMatchObject({ text: 'Not found', status: 404, error: 'HTTP 404' });
    expect(writeCache).not.toHaveBeenCalled();
  });

  it('keeps the text but reports an error and skips the cache when the status is unknown', async () => {
    networkFailure();
    mockExecuteScript.mockResolvedValue([{ result: pageResult({ status: 0 }) }]);

    const result = await executeWebFetch({ url: 'https://no-status.example.com' });

    expect(result.text).toBe('Extracted page text content from browser fallback.');
    expect(result.error).toBe('Could not determine the page HTTP status.');
    expect(writeCache).not.toHaveBeenCalled();
  });

  // ── Caching ──

  it('caches a successful fallback result', async () => {
    networkFailure();

    await executeWebFetch({ url: 'https://cors-blocked.example.com' });

    expect(writeCache).toHaveBeenCalled();
  });

  it('does not cache when the fallback returns empty content', async () => {
    networkFailure();
    mockExecuteScript.mockResolvedValue([{ result: pageResult({ text: '' }) }]);

    const result = await executeWebFetch({ url: 'https://empty-page.example.com' });

    expect(result.error).toContain('no content extracted');
    expect(writeCache).not.toHaveBeenCalled();
  });
});
