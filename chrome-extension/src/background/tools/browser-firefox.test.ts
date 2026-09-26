/**
 * Tests for browser-firefox.ts — Firefox browser tool via scripting API.
 *
 * This file tests the Firefox fallback implementation that uses
 * chrome.scripting.executeScript + chrome.tabs.* instead of chrome.debugger (CDP).
 *
 * NOTE: These tests will fail until browser-firefox.ts is created.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

// ── Chrome API mocks ──

const tabsOnUpdatedListeners: Array<(tabId: number, changeInfo: { status?: string }) => void> = [];

const mockTabsQuery = vi.fn<() => Promise<chrome.tabs.Tab[]>>(() =>
  Promise.resolve([
    {
      id: 1,
      title: 'Tab One',
      url: 'https://one.com',
      active: true,
      windowId: 1,
    } as chrome.tabs.Tab,
    {
      id: 2,
      title: 'Tab Two',
      url: 'https://two.com',
      active: false,
      windowId: 1,
    } as chrome.tabs.Tab,
  ]),
);
const mockTabsCreate = vi.fn((opts: { url: string }) =>
  Promise.resolve({ id: 99, title: '', url: opts.url, windowId: 1 } as chrome.tabs.Tab),
);
const mockTabsUpdate = vi.fn((tabId: number, _props: unknown) =>
  Promise.resolve({
    id: tabId,
    title: 'Updated',
    url: 'https://updated.com',
    windowId: 1,
  } as chrome.tabs.Tab),
);
const mockTabsRemove = vi.fn(() => Promise.resolve());
const mockTabsGet = vi.fn((tabId: number) =>
  Promise.resolve({
    id: tabId,
    title: 'Test Page',
    url: 'https://test.com',
    windowId: 1,
  } as chrome.tabs.Tab),
);
const mockTabsCaptureVisibleTab = vi.fn(() =>
  Promise.resolve('data:image/png;base64,iVBORw0KGgo='),
);

const mockWindowsUpdate = vi.fn(() => Promise.resolve());

const mockScriptingExecuteScript = vi.fn(() =>
  Promise.resolve([{ result: 'Hello world page text' }]),
);

Object.defineProperty(globalThis, 'chrome', {
  value: {
    tabs: {
      query: mockTabsQuery,
      create: mockTabsCreate,
      update: mockTabsUpdate,
      remove: mockTabsRemove,
      get: mockTabsGet,
      captureVisibleTab: mockTabsCaptureVisibleTab,
      onUpdated: {
        addListener: (fn: (tabId: number, changeInfo: { status?: string }) => void) => {
          tabsOnUpdatedListeners.push(fn);
        },
        removeListener: (fn: (tabId: number, changeInfo: { status?: string }) => void) => {
          const idx = tabsOnUpdatedListeners.indexOf(fn);
          if (idx >= 0) tabsOnUpdatedListeners.splice(idx, 1);
        },
      },
    },
    windows: {
      update: mockWindowsUpdate,
    },
    scripting: {
      executeScript: mockScriptingExecuteScript,
    },
    runtime: {
      lastError: undefined,
    },
  },
  writable: true,
  configurable: true,
});

// Mock webextension-polyfill as a no-op (browser-firefox.ts uses a declare global)
vi.mock('webextension-polyfill', () => ({ default: {} }));
vi.mock('./browser-visuals', () => ({ sendVisualCommand: vi.fn(async () => false) }));

Object.defineProperty(globalThis, 'browser', {
  value: {
    tabs: {
      captureVisibleTab: mockTabsCaptureVisibleTab,
    },
  },
  writable: true,
  configurable: true,
});

// ── Import after mocks ──
// This will fail until browser-firefox.ts is created
let executeBrowserFirefox: (args: Record<string, unknown>) => Promise<unknown>;

beforeEach(async () => {
  vi.clearAllMocks();
  tabsOnUpdatedListeners.length = 0;
  try {
    const mod = await import('./browser-firefox');
    executeBrowserFirefox = mod.executeBrowserFirefox;
  } catch {
    // Module doesn't exist yet — tests will fail with clear message
    executeBrowserFirefox = () => Promise.reject(new Error('browser-firefox.ts not yet created'));
  }
});

describe('browser-firefox — tab management actions', () => {
  it('tabs action returns formatted tab list', async () => {
    const result = await executeBrowserFirefox({ action: 'tabs' });
    expect(result).toContain('Tab One');
    expect(result).toContain('Tab Two');
    expect(result).toContain('https://one.com');
    expect(mockTabsQuery).toHaveBeenCalled();
  });

  it('open action creates tab with url', async () => {
    const result = await executeBrowserFirefox({ action: 'open', url: 'https://example.com' });
    expect(result).toContain('99');
    expect(mockTabsCreate).toHaveBeenCalledWith(
      expect.objectContaining({ url: 'https://example.com' }),
    );
  });

  it('close action removes tab', async () => {
    const result = await executeBrowserFirefox({ action: 'close', tabId: 1 });
    expect(mockTabsRemove).toHaveBeenCalledWith(1);
    expect(typeof result).toBe('string');
  });

  it('focus action updates tab and window', async () => {
    const result = await executeBrowserFirefox({ action: 'focus', tabId: 1 });
    expect(mockTabsUpdate).toHaveBeenCalledWith(1, { active: true });
    expect(mockWindowsUpdate).toHaveBeenCalled();
    expect(typeof result).toBe('string');
  });
});

describe('browser-firefox — content & scripting actions', () => {
  it('content action returns page text via executeScript', async () => {
    mockScriptingExecuteScript.mockResolvedValue([{ result: 'Page content here' }]);
    const result = await executeBrowserFirefox({ action: 'content', tabId: 1 });
    expect(result).toContain('Page content here');
    expect(mockScriptingExecuteScript).toHaveBeenCalledWith(
      expect.objectContaining({ target: { tabId: 1 } }),
    );
  });

  it('snapshot action injects DOM walker and returns text', async () => {
    mockScriptingExecuteScript.mockResolvedValue([
      { result: '[page] Test Page\n  [button] Click me' },
    ]);
    const result = await executeBrowserFirefox({ action: 'snapshot', tabId: 1 });
    expect(typeof result).toBe('string');
    expect(mockScriptingExecuteScript).toHaveBeenCalled();
  });

  it('screenshot action calls captureVisibleTab', async () => {
    const result = await executeBrowserFirefox({ action: 'screenshot', tabId: 1 });
    expect(mockTabsCaptureVisibleTab).toHaveBeenCalled();
    // Should return a screenshot result (string or ScreenshotResult)
    expect(result).toBeDefined();
  });
});

describe('browser-firefox — click and type actions', () => {
  it('click action injects script and returns result', async () => {
    mockScriptingExecuteScript.mockResolvedValueOnce([
      { result: 'Clicked element [5] <button> "Submit".' },
    ]);
    const result = (await executeBrowserFirefox({ action: 'click', tabId: 1, ref: 5 })) as string;
    expect(result).toContain('Clicked element [5]');
    expect(mockScriptingExecuteScript).toHaveBeenCalled();
  });

  it('click action returns error when ref not found', async () => {
    mockScriptingExecuteScript.mockResolvedValueOnce([
      { result: 'Error: Ref [99] not found. Run "snapshot" to refresh refs.' },
    ]);
    const result = (await executeBrowserFirefox({ action: 'click', tabId: 1, ref: 99 })) as string;
    expect(result).toContain('Ref [99] not found');
  });

  it('click action requires tabId', async () => {
    const result = (await executeBrowserFirefox({ action: 'click' })) as string;
    expect(result).toContain('tabId');
    expect(result).toContain('required');
  });

  it('click action requires ref', async () => {
    const result = (await executeBrowserFirefox({ action: 'click', tabId: 1 })) as string;
    expect(result).toContain('ref');
    expect(result).toContain('required');
  });

  it('type action injects script and returns result', async () => {
    mockScriptingExecuteScript.mockResolvedValueOnce([
      { result: 'Typed "hello" into element [3].' },
    ]);
    const result = (await executeBrowserFirefox({
      action: 'type',
      tabId: 1,
      ref: 3,
      text: 'hello',
    })) as string;
    expect(result).toContain('Typed');
    expect(result).toContain('[3]');
    expect(mockScriptingExecuteScript).toHaveBeenCalled();
  });

  it('type action requires text', async () => {
    const result = (await executeBrowserFirefox({ action: 'type', tabId: 1, ref: 3 })) as string;
    expect(result).toContain('text');
    expect(result).toContain('required');
  });
});

describe('browser-firefox — unsupported actions', () => {
  it('console action returns unavailable message', async () => {
    const result = (await executeBrowserFirefox({ action: 'console', tabId: 1 })) as string;
    expect(result.toLowerCase()).toContain('unavailable');
    expect(result.toLowerCase()).toContain('firefox');
  });

  it('network action returns unavailable message', async () => {
    const result = (await executeBrowserFirefox({ action: 'network', tabId: 1 })) as string;
    expect(result.toLowerCase()).toContain('unavailable');
    expect(result.toLowerCase()).toContain('firefox');
  });
});

describe('browser-firefox — input validation', () => {
  it('actions requiring tabId return error when missing', async () => {
    const result = (await executeBrowserFirefox({ action: 'content' })) as string;
    expect(result.toLowerCase()).toContain('error');
    expect(result.toLowerCase()).toContain('tabid');
  });

  it('coerces string tabId to number', async () => {
    await executeBrowserFirefox({ action: 'focus', tabId: '42' as unknown as number });
    expect(mockTabsUpdate).toHaveBeenCalledWith(42, { active: true });
  });

  it('coerces string ref to number for click', async () => {
    mockScriptingExecuteScript.mockResolvedValueOnce([{ result: 'Clicked element [3] <a>.' }]);
    const result = (await executeBrowserFirefox({
      action: 'click',
      tabId: 1,
      ref: '3' as unknown as number,
    })) as string;
    expect(result).toContain('Clicked element [3]');
    expect(mockScriptingExecuteScript).toHaveBeenCalled();
    // Verify the ref was passed as a number to the injected script
    const lastCall =
      mockScriptingExecuteScript.mock.calls[mockScriptingExecuteScript.mock.calls.length - 1];
    expect(lastCall[0].args[0].ref).toBe(3);
  });
});
