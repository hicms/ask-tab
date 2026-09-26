import { createLogger } from '../logging/logger-buffer';
import { IS_FIREFOX } from '@extension/env';
import type { AgentMessage } from '@mariozechner/pi-agent-core';

const tabGroupLog = createLogger('browser');

const GROUP_COLORS = ['blue', 'red', 'yellow', 'green', 'pink', 'purple', 'cyan'] as const;
const MAX_TITLE_LENGTH = 40;
const DEFAULT_TITLE = 'Agent';
const UNGROUPABLE_PROTOCOLS = new Set([
  'chrome:',
  'chrome-extension:',
  'edge:',
  'about:',
  'devtools:',
  'view-source:',
]);

interface AgentTabGroupSession {
  refs: number;
  title: string;
  color: (typeof GROUP_COLORS)[number];
  windowId: number | null;
  groupId: number | null;
  chain: Promise<void>;
}

type GroupableTab = chrome.tabs.Tab & { id: number };

const sessions = new Map<string, AgentTabGroupSession>();

// Resolve the windowId of the user's currently focused normal browser window.
// Primary path uses the active tab of the last-focused window. When focus is
// ambiguous (DevTools window, popup, minimized, no active tab), it falls back to
// chrome.windows.getLastFocused. Returns null only if both paths fail.
const getFocusedWindowId = async (): Promise<number | null> => {
  try {
    const [tab] = await chrome.tabs.query({ active: true, lastFocusedWindow: true });
    if (tab?.windowId != null) return tab.windowId;
  } catch {
    // fall through to the window-based fallback
  }
  try {
    const win = await chrome.windows.getLastFocused({ windowTypes: ['normal'] });
    return win?.id ?? null;
  } catch {
    return null;
  }
};

const tabGroupsSupported = (): boolean =>
  !IS_FIREFOX &&
  typeof chrome !== 'undefined' &&
  typeof chrome.tabs?.group === 'function' &&
  typeof chrome.tabGroups?.update === 'function';

const promptText = (prompt: AgentMessage | string): string => {
  if (typeof prompt === 'string') return prompt;
  if (!('content' in prompt)) return '';
  const { content } = prompt;
  if (typeof content === 'string') return content;
  return content.map(part => (part.type === 'text' ? part.text : '')).join(' ');
};

const formatTitle = (text: string): string => {
  const title = text.replace(/\s+/g, ' ').trim();
  if (!title) return DEFAULT_TITLE;
  if (title.length <= MAX_TITLE_LENGTH) return title;
  return `${title.slice(0, MAX_TITLE_LENGTH - 1)}\u2026`;
};

const isGroupable = (tab: chrome.tabs.Tab | undefined): tab is GroupableTab => {
  if (tab?.id == null || tab.pinned || !tab.url) return false;
  try {
    return !UNGROUPABLE_PROTOCOLS.has(new URL(tab.url).protocol);
  } catch {
    return false;
  }
};

const enqueue = <T>(session: AgentTabGroupSession, work: () => Promise<T>): Promise<T> => {
  const step = session.chain.then(work);
  session.chain = step.then(
    () => undefined,
    () => undefined,
  );
  return step;
};

const createGroup = async (session: AgentTabGroupSession, tab: GroupableTab): Promise<void> => {
  const groupId = await chrome.tabs.group({ tabIds: [tab.id] });
  session.groupId = groupId;
  session.windowId = tab.windowId;
  try {
    await chrome.tabGroups.update(groupId, {
      title: session.title,
      color: session.color,
      collapsed: false,
    });
  } catch (err) {
    tabGroupLog.warn('Agent tab group update failed', { groupId, error: String(err) });
  }
};

const resolveGroupWindow = async (session: AgentTabGroupSession): Promise<number | null> => {
  if (session.groupId != null) {
    try {
      session.windowId = (await chrome.tabGroups.get(session.groupId)).windowId;
      return session.windowId;
    } catch {
      session.groupId = null;
    }
  }
  if (session.windowId == null) {
    session.windowId = await getFocusedWindowId();
    return session.windowId;
  }
  try {
    await chrome.windows.get(session.windowId);
    return session.windowId;
  } catch {
    session.windowId = null;
    return null;
  }
};

const addToGroup = async (session: AgentTabGroupSession, tab: chrome.tabs.Tab): Promise<void> => {
  if (tab.id == null) return;
  if (session.windowId != null && tab.windowId !== session.windowId) return;
  if (session.groupId != null && tab.groupId === session.groupId) return;
  if (session.groupId == null) {
    await createGroup(session, tab as GroupableTab);
    return;
  }
  await chrome.tabs.group({ tabIds: [tab.id], groupId: session.groupId });
};

const beginAgentTabGroup = async (
  chatId: string | undefined,
  prompt: AgentMessage | string,
): Promise<void> => {
  if (!chatId || !tabGroupsSupported()) return;
  const existing = sessions.get(chatId);
  if (existing) {
    existing.refs += 1;
    return;
  }
  const session: AgentTabGroupSession = {
    refs: 1,
    title: formatTitle(promptText(prompt)),
    color: GROUP_COLORS[Math.floor(Math.random() * GROUP_COLORS.length)]!,
    windowId: null,
    groupId: null,
    chain: Promise.resolve(),
  };
  sessions.set(chatId, session);
};

const endAgentTabGroup = (chatId: string | undefined): void => {
  if (!chatId) return;
  const session = sessions.get(chatId);
  if (!session) return;
  session.refs -= 1;
  if (session.refs <= 0) sessions.delete(chatId);
};

const groupAgentTab = async (chatId: string | undefined, tabId: number): Promise<void> => {
  const session = chatId ? sessions.get(chatId) : undefined;
  if (!session) return;
  await enqueue(session, async () => {
    const tab = await chrome.tabs.get(tabId);
    if (!isGroupable(tab)) return;
    await resolveGroupWindow(session);
    await addToGroup(session, tab);
  }).catch(err => {
    tabGroupLog.warn('Adding tab to agent group failed', { chatId, tabId, error: String(err) });
  });
};

const openAgentTab = async (
  chatId: string | undefined,
  props: { url: string; active: boolean },
): Promise<chrome.tabs.Tab> => {
  const session = chatId ? sessions.get(chatId) : undefined;
  if (!session) return chrome.tabs.create(props);
  return enqueue(session, async () => {
    const windowId = await resolveGroupWindow(session);
    const tab = await chrome.tabs.create(windowId != null ? { ...props, windowId } : props);
    await addToGroup(session, tab).catch(err => {
      tabGroupLog.warn('Adding tab to agent group failed', { chatId, error: String(err) });
    });
    return tab;
  });
};

export { beginAgentTabGroup, endAgentTabGroup, getFocusedWindowId, groupAgentTab, openAgentTab };
