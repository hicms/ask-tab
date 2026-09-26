import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { BrowserArgs } from '../../chrome-extension/src/background/tools/browser-schema';

vi.mock('@extension/env', () => ({ IS_FIREFOX: false }));
vi.mock('../../chrome-extension/src/background/logging/logger-buffer', () => ({
  createLogger: () => ({ debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() }),
}));
vi.mock('../../chrome-extension/src/background/tools/tab-indicator', () => ({
  injectControlIndicator: vi.fn(async () => {}),
  removeControlIndicator: vi.fn(async () => {}),
}));

const tabs = new Map<number, chrome.tabs.Tab>();
const group = vi.fn(async (opts: chrome.tabs.GroupOptions) => {
  const groupId = opts.groupId ?? 100;
  const ids = typeof opts.tabIds === 'number' ? [opts.tabIds] : opts.tabIds;
  for (const id of ids ?? []) tabs.get(id)!.groupId = groupId;
  return groupId;
});
const createTab = (id: number, props: Partial<chrome.tabs.Tab> = {}): chrome.tabs.Tab => {
  const tab = {
    id,
    windowId: 1,
    url: 'https://example.com',
    groupId: -1,
    ...props,
  } as chrome.tabs.Tab;
  tabs.set(id, tab);
  return tab;
};

let browser: typeof import('../../chrome-extension/src/background/tools/browser');
let groups: typeof import('../../chrome-extension/src/background/tools/agent-tab-group');

beforeEach(async () => {
  vi.resetModules();
  vi.clearAllMocks();
  tabs.clear();
  createTab(1, { active: true });
  createTab(2);
  let nextId = 50;
  vi.stubGlobal('chrome', {
    debugger: {
      onDetach: { addListener: vi.fn() },
      onEvent: { addListener: vi.fn() },
    },
    tabs: {
      query: vi.fn(async () => [tabs.get(1)]),
      get: vi.fn(async (id: number) => ({ ...tabs.get(id) })),
      create: vi.fn(async (props: chrome.tabs.CreateProperties) => createTab(nextId++, props)),
      remove: vi.fn(async (id: number) => {
        tabs.delete(id);
      }),
      group,
      onRemoved: { addListener: vi.fn() },
    },
    tabGroups: {
      query: vi.fn(async () => []),
      get: vi.fn(async (id: number) => ({ id, windowId: 1, title: 'Existing' })),
      update: vi.fn(async () => ({})),
    },
    windows: {
      get: vi.fn(async (id: number) => ({ id })),
      getLastFocused: vi.fn(async () => ({ id: 1 })),
    },
    scripting: { executeScript: vi.fn(async () => [{ result: 'Page content' }]) },
  });
  browser = await import('../../chrome-extension/src/background/tools/browser');
  groups = await import('../../chrome-extension/src/background/tools/agent-tab-group');
  await groups.beginAgentTabGroup('chat', 'Research');
});

afterEach(() => {
  groups.endAgentTabGroup('chat');
  vi.unstubAllGlobals();
});

describe('browser operations create groups only when needed', () => {
  it.each<BrowserArgs>([
    { action: 'tabs' },
    { action: 'list_tab_groups' },
    { action: 'wait', seconds: 0 },
    { action: 'close', tabId: 2 },
  ])('does not create a group for $action', async args => {
    const result = await browser.executeBrowser(args, { chatId: 'chat' });
    expect(result).not.toContain('Error:');
    expect(group).not.toHaveBeenCalled();
  });

  it('groups the actual page, then reuses its group for continued operations and new tabs', async () => {
    expect(group).not.toHaveBeenCalled();
    for (let i = 0; i < 2; i++) {
      const result = await browser.executeBrowser(
        { action: 'content', tabId: 2 },
        { chatId: 'chat' },
      );
      expect(result).toBe('Page content');
    }
    await browser.executeBrowser({ action: 'open', url: 'https://next.com' }, { chatId: 'chat' });
    expect(group.mock.calls).toEqual([[{ tabIds: [2] }], [{ tabIds: [50], groupId: 100 }]]);
    expect(tabs.get(1)!.groupId).toBe(-1);
  });

  it('creates one group for parallel opens without touching the active tab', async () => {
    await Promise.all([
      browser.executeBrowser({ action: 'open', url: 'https://a.com' }, { chatId: 'chat' }),
      browser.executeBrowser({ action: 'open', url: 'https://b.com' }, { chatId: 'chat' }),
    ]);
    expect(group.mock.calls).toEqual([[{ tabIds: [50] }], [{ tabIds: [51], groupId: 100 }]]);
    expect(tabs.get(1)!.groupId).toBe(-1);
  });

  it('does not create an automatic group for explicitly grouped opens', async () => {
    await browser.executeBrowser(
      { action: 'open', url: 'https://a.com', groupId: 200 },
      { chatId: 'chat' },
    );
    expect(group.mock.calls).toEqual([[{ tabIds: [50], groupId: 200 }]]);
  });

  it('does not group a page when its operation is already cancelled', async () => {
    const result = await browser.executeBrowser(
      { action: 'content', tabId: 2 },
      { chatId: 'chat', signal: AbortSignal.abort() },
    );
    expect(result).toContain('cancelled');
    expect(group).not.toHaveBeenCalled();
  });
});
