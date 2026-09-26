import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { AgentMessage } from '@mariozechner/pi-agent-core';

const env = vi.hoisted(() => ({ firefox: false }));
const mockWarn = vi.hoisted(() => vi.fn());

vi.mock('@extension/env', () => ({
  get IS_FIREFOX() {
    return env.firefox;
  },
}));

vi.mock('../../chrome-extension/src/background/logging/logger-buffer', () => ({
  createLogger: () => ({
    debug: vi.fn(),
    info: vi.fn(),
    warn: mockWarn,
    error: vi.fn(),
    trace: vi.fn(),
  }),
}));

const PALETTE = ['blue', 'red', 'yellow', 'green', 'pink', 'purple', 'cyan'];

const activeTab = (overrides: Partial<chrome.tabs.Tab> = {}): chrome.tabs.Tab =>
  ({
    id: 10,
    url: 'https://example.com',
    active: true,
    pinned: false,
    windowId: 1,
    ...overrides,
  }) as chrome.tabs.Tab;

const mockTabsQuery = vi.fn<(info: chrome.tabs.QueryInfo) => Promise<chrome.tabs.Tab[]>>();
const mockTabsGet = vi.fn<(id: number) => Promise<chrome.tabs.Tab>>();
const mockTabsCreate = vi.fn<(props: chrome.tabs.CreateProperties) => Promise<chrome.tabs.Tab>>();
const mockTabsGroup = vi.fn<(opts: chrome.tabs.GroupOptions) => Promise<number>>();
const mockTabsUngroup = vi.fn();
const mockTabGroupsUpdate =
  vi.fn<
    (id: number, props: chrome.tabGroups.UpdateProperties) => Promise<chrome.tabGroups.TabGroup>
  >();
const mockTabGroupsGet = vi.fn<(id: number) => Promise<chrome.tabGroups.TabGroup>>();
const mockWindowsGet = vi.fn<(id: number) => Promise<chrome.windows.Window>>();
const mockWindowsGetLastFocused = vi.fn<() => Promise<chrome.windows.Window>>();

const chromeMock = {
  tabs: {
    query: mockTabsQuery,
    get: mockTabsGet,
    create: mockTabsCreate,
    group: mockTabsGroup as typeof mockTabsGroup | undefined,
    ungroup: mockTabsUngroup,
  },
  tabGroups: { update: mockTabGroupsUpdate, get: mockTabGroupsGet },
  windows: { get: mockWindowsGet, getLastFocused: mockWindowsGetLastFocused },
};

Object.defineProperty(globalThis, 'chrome', {
  value: chromeMock,
  writable: true,
  configurable: true,
});

let mod: typeof import('../../chrome-extension/src/background/tools/agent-tab-group');

beforeEach(async () => {
  vi.resetModules();
  vi.clearAllMocks();
  env.firefox = false;
  chromeMock.tabs.group = mockTabsGroup;

  mockTabsQuery.mockImplementation(async info =>
    info.lastFocusedWindow ? [activeTab()] : [activeTab({ windowId: info.windowId ?? 1 })],
  );
  const groupedTabs = new Map<number, number>();
  mockTabsGet.mockImplementation(async id => activeTab({ id, groupId: groupedTabs.get(id) ?? -1 }));
  let nextTabId = 50;
  mockTabsCreate.mockImplementation(async props =>
    activeTab({ id: nextTabId++, url: props.url, active: false, windowId: props.windowId ?? 1 }),
  );
  mockTabsGroup.mockImplementation(async opts => {
    const groupId = opts.groupId ?? 100;
    const ids = typeof opts.tabIds === 'number' ? [opts.tabIds] : opts.tabIds;
    for (const id of ids ?? []) groupedTabs.set(id, groupId);
    return groupId;
  });
  mockTabGroupsUpdate.mockImplementation(
    async id => ({ id, windowId: 1 }) as chrome.tabGroups.TabGroup,
  );
  mockTabGroupsGet.mockImplementation(
    async id => ({ id, windowId: 1 }) as chrome.tabGroups.TabGroup,
  );
  mockWindowsGet.mockImplementation(async id => ({ id }) as chrome.windows.Window);
  mockWindowsGetLastFocused.mockResolvedValue({ id: 1 } as chrome.windows.Window);

  mod = await import('../../chrome-extension/src/background/tools/agent-tab-group');
});

describe('beginAgentTabGroup', () => {
  it('groups the operated tab and sets title, palette color, and expanded state', async () => {
    await mod.beginAgentTabGroup('chat-1', 'Find flights to Tokyo');
    await mod.groupAgentTab('chat-1', 10);

    expect(mockTabsGet).toHaveBeenCalledWith(10);
    expect(mockTabsGroup).toHaveBeenCalledTimes(1);
    expect(mockTabsGroup).toHaveBeenCalledWith({ tabIds: [10] });
    expect(mockTabGroupsUpdate).toHaveBeenCalledTimes(1);
    const [groupId, props] = mockTabGroupsUpdate.mock.calls[0]!;
    expect(groupId).toBe(100);
    expect(props.title).toBe('Find flights to Tokyo');
    expect(PALETTE).toContain(props.color);
    expect(props.collapsed).toBe(false);
  });

  it('collapses whitespace and truncates long titles to 40 characters', async () => {
    const prompt = `  Compare   the\nprices ${'x'.repeat(60)}  `;
    await mod.beginAgentTabGroup('chat-1', prompt);
    await mod.groupAgentTab('chat-1', 10);

    const title = mockTabGroupsUpdate.mock.calls[0]![1].title!;
    expect(title).toHaveLength(40);
    expect(title.endsWith('\u2026')).toBe(true);
    expect(title.startsWith('Compare the prices x')).toBe(true);
  });

  it('builds the title from text parts of an AgentMessage and falls back to "Agent"', async () => {
    const message = {
      role: 'user',
      content: [
        { type: 'image', data: 'abc', mimeType: 'image/png' },
        { type: 'text', text: 'Summarize' },
        { type: 'text', text: 'this page' },
      ],
      timestamp: 0,
    } as AgentMessage;
    await mod.beginAgentTabGroup('chat-1', message);
    await mod.groupAgentTab('chat-1', 10);
    expect(mockTabGroupsUpdate.mock.calls[0]![1].title).toBe('Summarize this page');

    await mod.beginAgentTabGroup('chat-2', '   ');
    await mod.groupAgentTab('chat-2', 10);
    expect(mockTabGroupsUpdate.mock.calls[1]![1].title).toBe('Agent');
  });

  it('shares one group across nested runs of the same chat, even when started concurrently', async () => {
    await Promise.all([
      mod.beginAgentTabGroup('chat-1', 'Parent task'),
      mod.beginAgentTabGroup('chat-1', 'Subagent task'),
    ]);
    await mod.beginAgentTabGroup('chat-1', 'Another nested task');
    await mod.groupAgentTab('chat-1', 10);

    expect(mockTabsGroup).toHaveBeenCalledTimes(1);
    expect(mockTabGroupsUpdate).toHaveBeenCalledTimes(1);
    expect(mockTabGroupsUpdate.mock.calls[0]![1].title).toBe('Parent task');
  });

  it('forgets the run after the last end and never ungroups', async () => {
    await mod.beginAgentTabGroup('chat-1', 'First');
    await mod.groupAgentTab('chat-1', 10);
    await mod.beginAgentTabGroup('chat-1', 'Nested');
    await mod.groupAgentTab('chat-1', 10);
    mod.endAgentTabGroup('chat-1');
    await mod.beginAgentTabGroup('chat-1', 'Still nested');
    await mod.groupAgentTab('chat-1', 10);
    expect(mockTabsGroup).toHaveBeenCalledTimes(1);

    mod.endAgentTabGroup('chat-1');
    mod.endAgentTabGroup('chat-1');
    await mod.beginAgentTabGroup('chat-1', 'Next message');
    await mod.groupAgentTab('chat-1', 10);

    expect(mockTabsGroup).toHaveBeenCalledTimes(2);
    expect(mockTabGroupsUpdate.mock.calls[1]![1].title).toBe('Next message');
    expect(mockTabsUngroup).not.toHaveBeenCalled();
  });

  it.each([
    ['pinned tab', { pinned: true }],
    ['chrome:// page', { url: 'chrome://settings' }],
    ['extension page', { url: 'chrome-extension://abc/side-panel/index.html' }],
    ['about: page', { url: 'about:blank' }],
    ['tab without url', { url: undefined }],
  ])('does not group an ungroupable operated tab (%s)', async (_label, overrides) => {
    mockTabsGet.mockResolvedValue(activeTab(overrides));

    await mod.beginAgentTabGroup('chat-1', 'Task');
    await mod.groupAgentTab('chat-1', 10);

    expect(mockTabsGroup).not.toHaveBeenCalled();
  });

  it('groups file:// tabs', async () => {
    mockTabsGet.mockResolvedValue(activeTab({ url: 'file:///C:/notes.txt' }));

    await mod.beginAgentTabGroup('chat-1', 'Task');
    await mod.groupAgentTab('chat-1', 10);

    expect(mockTabsGroup).toHaveBeenCalledWith({ tabIds: [10] });
  });

  it('groups the operated tab in the focused window', async () => {
    mockTabsGet.mockResolvedValue(activeTab({ windowId: 2 }));
    mockTabsQuery.mockImplementation(async info =>
      info.lastFocusedWindow ? [activeTab({ windowId: 2 })] : [activeTab({ windowId: 2 })],
    );

    await mod.beginAgentTabGroup('chat-1', 'Task');
    await mod.groupAgentTab('chat-1', 10);

    expect(mockTabsQuery).toHaveBeenCalledWith({ active: true, lastFocusedWindow: true });
    expect(mockTabsQuery).not.toHaveBeenCalledWith(expect.objectContaining({ windowId: 1 }));
    expect(mockTabsGroup).toHaveBeenCalledWith({ tabIds: [10] });
  });

  it('does not pull an operated tab from another window into the task', async () => {
    mockTabsGet.mockResolvedValue(activeTab({ windowId: 2 }));
    await mod.beginAgentTabGroup('chat-1', 'Task');
    await mod.groupAgentTab('chat-1', 10);
    expect(mockTabsGroup).not.toHaveBeenCalled();
  });

  it('serializes a first page operation and a concurrent open into one group', async () => {
    await mod.beginAgentTabGroup('chat-1', 'Task');
    await Promise.all([
      mod.groupAgentTab('chat-1', 10),
      mod.openAgentTab('chat-1', { url: 'https://a.com', active: false }),
    ]);
    await mod.groupAgentTab('chat-1', 10);
    expect(mockTabsGroup.mock.calls).toEqual([
      [{ tabIds: [10] }],
      [{ tabIds: [50], groupId: 100 }],
    ]);
  });

  it('is a no-op without a chatId', async () => {
    await mod.beginAgentTabGroup(undefined, 'Task');
    mod.endAgentTabGroup(undefined);

    expect(mockTabsQuery).not.toHaveBeenCalled();
    expect(mockTabsGroup).not.toHaveBeenCalled();
  });

  it('skips grouping on Firefox without throwing', async () => {
    env.firefox = true;

    await expect(mod.beginAgentTabGroup('chat-1', 'Task')).resolves.toBeUndefined();
    await mod.openAgentTab('chat-1', { url: 'https://a.com', active: false });

    expect(mockTabsQuery).not.toHaveBeenCalled();
    expect(mockTabsGroup).not.toHaveBeenCalled();
    expect(mockTabsCreate).toHaveBeenCalledWith({ url: 'https://a.com', active: false });
  });

  it('skips grouping when chrome.tabs.group is unavailable', async () => {
    chromeMock.tabs.group = undefined;

    await expect(mod.beginAgentTabGroup('chat-1', 'Task')).resolves.toBeUndefined();

    expect(mockTabsQuery).not.toHaveBeenCalled();
  });

  it('logs and resolves when grouping fails', async () => {
    mockTabsGroup.mockRejectedValueOnce(new Error('Tabs cannot be edited right now'));

    await mod.beginAgentTabGroup('chat-1', 'Task');
    await expect(mod.groupAgentTab('chat-1', 10)).resolves.toBeUndefined();

    expect(mockTabGroupsUpdate).not.toHaveBeenCalled();
    expect(mockWarn).toHaveBeenCalledWith(
      'Adding tab to agent group failed',
      expect.objectContaining({ chatId: 'chat-1' }),
    );
  });

  it('keeps the group when only the title/color update fails', async () => {
    mockTabGroupsUpdate.mockRejectedValueOnce(new Error('boom'));
    await mod.beginAgentTabGroup('chat-1', 'Task');
    await mod.groupAgentTab('chat-1', 10);

    await mod.openAgentTab('chat-1', { url: 'https://a.com', active: false });

    expect(mockTabsGroup).toHaveBeenLastCalledWith({ tabIds: [50], groupId: 100 });
    expect(mockWarn).toHaveBeenCalledWith(
      'Agent tab group update failed',
      expect.objectContaining({ groupId: 100 }),
    );
  });
});

describe('openAgentTab', () => {
  it('groups a newly opened tab while its URL is still pending', async () => {
    await mod.beginAgentTabGroup('chat-1', 'Task');
    mockTabsCreate.mockResolvedValueOnce(
      activeTab({ id: 50, url: '', pendingUrl: 'https://a.com' }),
    );
    await mod.openAgentTab('chat-1', { url: 'https://a.com', active: false });
    expect(mockTabsGroup).toHaveBeenCalledWith({ tabIds: [50] });
  });

  it('creates a plain tab when the chat has no running agent', async () => {
    const tab = await mod.openAgentTab('chat-1', { url: 'https://a.com', active: false });

    expect(tab.id).toBe(50);
    expect(mockTabsCreate).toHaveBeenCalledWith({ url: 'https://a.com', active: false });
    expect(mockTabsGroup).not.toHaveBeenCalled();
  });

  it("adds new tabs to the run's group in the group's window", async () => {
    await mod.beginAgentTabGroup('chat-1', 'Task');
    await mod.groupAgentTab('chat-1', 10);

    const tab = await mod.openAgentTab('chat-1', { url: 'https://a.com', active: false });

    expect(tab.id).toBe(50);
    expect(mockTabGroupsGet).toHaveBeenCalledWith(100);
    expect(mockTabsCreate).toHaveBeenCalledWith({
      url: 'https://a.com',
      active: false,
      windowId: 1,
    });
    expect(mockTabsGroup).toHaveBeenLastCalledWith({ tabIds: [50], groupId: 100 });
  });

  it('follows the group when the user moved it to another window', async () => {
    await mod.beginAgentTabGroup('chat-1', 'Task');
    await mod.groupAgentTab('chat-1', 10);
    mockTabGroupsGet.mockResolvedValueOnce({ id: 100, windowId: 3 } as chrome.tabGroups.TabGroup);

    await mod.openAgentTab('chat-1', { url: 'https://a.com', active: false });

    expect(mockTabsCreate).toHaveBeenCalledWith(expect.objectContaining({ windowId: 3 }));
    expect(mockTabsGroup).toHaveBeenLastCalledWith({ tabIds: [50], groupId: 100 });
  });

  it('does not group a tab that ended up in another window', async () => {
    await mod.beginAgentTabGroup('chat-1', 'Task');
    await mod.groupAgentTab('chat-1', 10);
    mockTabsCreate.mockResolvedValueOnce(activeTab({ id: 77, windowId: 2 }));

    const tab = await mod.openAgentTab('chat-1', { url: 'https://a.com', active: false });

    expect(tab.id).toBe(77);
    expect(mockTabsGroup).toHaveBeenCalledTimes(1);
    expect(mockTabsGroup).not.toHaveBeenCalledWith(expect.objectContaining({ tabIds: [77] }));
  });

  it('creates the group with the first opened tab without grouping the unrelated active tab', async () => {
    await mod.beginAgentTabGroup('chat-1', 'Lazy task');
    expect(mockTabsGroup).not.toHaveBeenCalled();

    await mod.openAgentTab('chat-1', { url: 'https://a.com', active: false });
    await mod.openAgentTab('chat-1', { url: 'https://b.com', active: false });

    expect(mockTabsCreate).toHaveBeenNthCalledWith(1, {
      url: 'https://a.com',
      active: false,
      windowId: 1,
    });
    expect(mockTabsGroup).toHaveBeenNthCalledWith(1, { tabIds: [50] });
    expect(mockTabsGroup).toHaveBeenNthCalledWith(2, { tabIds: [51], groupId: 100 });
    expect(mockTabGroupsUpdate).toHaveBeenCalledTimes(1);
    expect(mockTabGroupsUpdate.mock.calls[0]![1]).toMatchObject({
      title: 'Lazy task',
      collapsed: false,
    });
  });

  it('creates only one group when tabs are opened in parallel before a group exists', async () => {
    await mod.beginAgentTabGroup('chat-1', 'Task');

    await Promise.all([
      mod.openAgentTab('chat-1', { url: 'https://a.com', active: false }),
      mod.openAgentTab('chat-1', { url: 'https://b.com', active: false }),
    ]);

    const withoutGroupId = mockTabsGroup.mock.calls.filter(([opts]) => opts.groupId == null);
    expect(withoutGroupId).toHaveLength(1);
    expect(mockTabsGroup).toHaveBeenCalledTimes(2);
  });

  it('opens in the default window and regroups when the group window was closed', async () => {
    mockTabsQuery.mockImplementation(async () => [activeTab({ url: 'chrome://newtab' })]);
    await mod.beginAgentTabGroup('chat-1', 'Task');
    await mod.groupAgentTab('chat-1', 10);
    mockTabGroupsGet.mockRejectedValueOnce(new Error('No group with id: 100.'));
    mockWindowsGet.mockRejectedValueOnce(new Error('No window with id: 1.'));
    mockTabsCreate.mockResolvedValueOnce(activeTab({ id: 60, windowId: 4 }));

    const tab = await mod.openAgentTab('chat-1', { url: 'https://a.com', active: false });

    expect(tab.id).toBe(60);
    expect(mockTabsCreate).toHaveBeenCalledWith({ url: 'https://a.com', active: false });
    expect(mockTabsGroup).toHaveBeenCalledWith({ tabIds: [60] });
  });

  it('starts a new group when the previous one no longer exists', async () => {
    await mod.beginAgentTabGroup('chat-1', 'Task');
    await mod.groupAgentTab('chat-1', 10);
    mockTabGroupsGet.mockRejectedValueOnce(new Error('No group with id: 100.'));
    mockTabsGroup.mockResolvedValueOnce(200);

    await mod.openAgentTab('chat-1', { url: 'https://a.com', active: false });
    await mod.openAgentTab('chat-1', { url: 'https://b.com', active: false });

    expect(mockTabsGroup).toHaveBeenNthCalledWith(2, { tabIds: [50] });
    expect(mockTabsGroup).toHaveBeenNthCalledWith(3, { tabIds: [51], groupId: 200 });
  });

  it('returns the tab and logs when adding it to the group fails', async () => {
    await mod.beginAgentTabGroup('chat-1', 'Task');
    await mod.groupAgentTab('chat-1', 10);
    mockTabsGroup.mockRejectedValueOnce(new Error('Tabs cannot be edited right now'));

    const tab = await mod.openAgentTab('chat-1', { url: 'https://a.com', active: false });
    const next = await mod.openAgentTab('chat-1', { url: 'https://b.com', active: false });

    expect(tab.id).toBe(50);
    expect(next.id).toBe(51);
    expect(mockTabsGroup).toHaveBeenLastCalledWith({ tabIds: [51], groupId: 100 });
    expect(mockWarn).toHaveBeenCalledWith(
      'Adding tab to agent group failed',
      expect.objectContaining({ chatId: 'chat-1' }),
    );
  });

  it('propagates tab creation errors', async () => {
    await mod.beginAgentTabGroup('chat-1', 'Task');
    await mod.groupAgentTab('chat-1', 10);
    mockTabsCreate.mockRejectedValueOnce(new Error('Invalid url'));

    await expect(mod.openAgentTab('chat-1', { url: 'bad://x', active: false })).rejects.toThrow(
      'Invalid url',
    );
    await expect(
      mod.openAgentTab('chat-1', { url: 'https://a.com', active: false }),
    ).resolves.toMatchObject({ id: 50 });
  });
});

describe('getFocusedWindowId', () => {
  it('uses the active tab of the last-focused window', async () => {
    mockTabsQuery.mockResolvedValueOnce([activeTab({ windowId: 7 })]);

    await expect(mod.getFocusedWindowId()).resolves.toBe(7);
    expect(mockTabsQuery).toHaveBeenCalledWith({ active: true, lastFocusedWindow: true });
  });

  it('falls back to the last-focused normal window', async () => {
    mockTabsQuery.mockRejectedValueOnce(new Error('query failed'));
    mockWindowsGetLastFocused.mockResolvedValueOnce({ id: 8 } as chrome.windows.Window);

    await expect(mod.getFocusedWindowId()).resolves.toBe(8);
    expect(mockWindowsGetLastFocused).toHaveBeenCalledWith({ windowTypes: ['normal'] });
  });

  it('returns null when both lookups fail', async () => {
    mockTabsQuery.mockResolvedValueOnce([]);
    mockWindowsGetLastFocused.mockRejectedValueOnce(new Error('no window'));

    await expect(mod.getFocusedWindowId()).resolves.toBeNull();
  });
});
