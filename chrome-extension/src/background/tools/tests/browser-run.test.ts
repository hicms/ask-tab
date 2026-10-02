import { releaseToolResources } from '../tool-lifecycle';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type * as BrowserModule from '../browser';

const { cdp, visual, scriptingClear, fallback } = vi.hoisted(() => ({
  cdp: vi.fn(),
  visual: vi.fn(async () => true),
  scriptingClear: vi.fn(async () => {}),
  fallback: vi.fn(async () => '[1] button fallback'),
}));
vi.mock('../cdp', () => ({
  cdpSend: cdp,
  cdpSendWithReattach: cdp,
  keepTabRendering: vi.fn(async () => {}),
}));
vi.mock('../browser-visuals', () => ({
  clearSnapshotVisuals: vi.fn(),
  showCdpSnapshotVisuals: vi.fn(),
  sendVisualCommand: visual,
}));
vi.mock('../browser-firefox', () => ({
  executeBrowserFirefox: fallback,
  clearFirefoxSnapshot: scriptingClear,
}));
vi.mock('../tab-indicator', () => ({
  injectControlIndicator: vi.fn(),
  removeControlIndicator: vi.fn(async () => {}),
}));
vi.mock('@extension/env', () => ({ IS_FIREFOX: false }));
vi.mock('../../logging/logger-buffer', () => ({
  createLogger: () => ({
    trace: vi.fn(),
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  }),
}));

let browser: typeof BrowserModule;
beforeEach(async () => {
  vi.clearAllMocks();
  vi.stubGlobal('chrome', {
    tabs: {
      get: vi.fn(async () => ({ title: 'Test', url: 'https://example.test' })),
      create: vi.fn(async () => ({ id: 9, url: 'https://example.test' })),
      group: vi.fn(async () => 1),
      onRemoved: { addListener: vi.fn() },
    },
    tabGroups: { get: vi.fn(async () => ({ title: 'Test' })) },
    debugger: {
      attach: vi.fn((_target, _version, done) => done()),
      detach: vi.fn((_target, done) => done()),
      onDetach: { addListener: vi.fn() },
      onEvent: { addListener: vi.fn() },
    },
    runtime: { lastError: undefined },
  });
  browser = await import('../browser');
  browser.sessions.clear();
  cdp.mockResolvedValue({
    root: {
      nodeId: 1,
      backendNodeId: 1,
      nodeType: 9,
      nodeName: '#document',
      children: [{ nodeId: 2, backendNodeId: 2, nodeType: 1, nodeName: 'BUTTON', children: [] }],
    },
  });
});

describe('registered browser run', () => {
  it.each(['cdp', 'scripting'])(
    'clears both worlds and invalidates %s snapshot refs when the run releases resources',
    async backend => {
      const signal = new AbortController().signal;
      const session = browser.getOrCreateSession(4);
      session.attached = true;
      if (backend === 'scripting')
        cdp.mockImplementation(async (_tabId, method) => {
          if (method === 'DOM.getDocument') throw new Error('debugger detached');
          return {};
        });
      expect(browser.browserToolDef.needsContext).toBe(true);
      await browser.browserToolDef.execute({ action: 'snapshot', tabId: 4 }, { signal });
      expect(session.snapshotBackend).toBe(backend);
      expect(chrome.debugger.detach).not.toHaveBeenCalled();
      await releaseToolResources(signal);
      expect(visual).toHaveBeenCalledWith(4, 'MAIN', 'reset');
      expect(scriptingClear).toHaveBeenCalledWith(4);
      expect(session.refMap.size).toBe(0);
      expect(session.snapshotBackend).toBeUndefined();
      expect(chrome.debugger.detach).toHaveBeenCalledExactlyOnceWith(
        { tabId: 4 },
        expect.any(Function),
      );
      expect(browser.sessions.has(4)).toBe(false);
    },
  );

  it('releases a newly opened tab even when the task never takes a snapshot', async () => {
    const signal = new AbortController().signal;
    await browser.browserToolDef.execute(
      { action: 'open', url: 'https://example.test', groupId: 1 },
      { signal },
    );
    expect(chrome.debugger.attach).toHaveBeenCalledWith({ tabId: 9 }, '1.3', expect.any(Function));
    expect(chrome.debugger.detach).not.toHaveBeenCalled();
    await releaseToolResources(signal);
    expect(chrome.debugger.detach).toHaveBeenCalledExactlyOnceWith(
      { tabId: 9 },
      expect.any(Function),
    );
    expect(browser.sessions.has(9)).toBe(false);
  });

  it('keeps a tab connected and its snapshot usable while another task owns it', async () => {
    const first = new AbortController().signal;
    const second = new AbortController().signal;
    await browser.browserToolDef.execute({ action: 'snapshot', tabId: 4 }, { signal: first });
    await browser.browserToolDef.execute({ action: 'snapshot', tabId: 4 }, { signal: second });
    await releaseToolResources(first);
    expect(chrome.debugger.detach).not.toHaveBeenCalled();
    expect(browser.sessions.get(4)?.attached).toBe(true);
    expect(browser.sessions.get(4)?.refMap.size).toBeGreaterThan(0);
    await releaseToolResources(second);
    expect(chrome.debugger.detach).toHaveBeenCalledOnce();
    expect(browser.sessions.has(4)).toBe(false);
  });
});
