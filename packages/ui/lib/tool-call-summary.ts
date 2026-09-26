/**
 * Pure helpers for compact, human-readable tool-call presentation in the chat UI.
 *
 * Most tool executors already return a human-readable string (e.g. "Navigated tab [5] to
 * https://…", "Created notes.md (312 chars)") — `summarizeToolCall` reuses that text as the
 * one-line summary whenever possible instead of re-deriving it, and only falls back to
 * bespoke logic for the handful of tools whose result is structured data (web_search,
 * web_fetch, Google Workspace tools, etc).
 */

import {
  AppWindowIcon,
  BotIcon,
  BugIcon,
  CalendarIcon,
  ClockIcon,
  CodeIcon,
  FileIcon,
  FileTextIcon,
  FolderIcon,
  GlobeIcon,
  HardDriveIcon,
  ImageIcon,
  MailIcon,
  MousePointerClickIcon,
  SearchIcon,
  TerminalIcon,
  WrenchIcon,
} from 'lucide-react';
import type { ToolPartState } from '@extension/shared';
import type { LucideIcon } from 'lucide-react';

/**
 * Semantic grouping used to colour tool icons. Colours are assigned per category (not per
 * tool) in the .tsx layer, since Tailwind only scans .tsx files in this package.
 */
type ToolCategory =
  | 'web' // information retrieval from the internet
  | 'browser' // acting on browser tabs/pages
  | 'code' // running code, devtools
  | 'files' // workspace files and documents
  | 'google' // Gmail / Calendar / Drive
  | 'agents' // subagents, agent registry, scheduled automation
  | 'memory' // recalling stored knowledge
  | 'other'; // custom / unknown tools

const getToolCategory = (toolName: string): ToolCategory => {
  switch (toolName) {
    case 'web_search':
    case 'web_fetch':
    case 'deep_research':
      return 'web';
    case 'browser':
      return 'browser';
    case 'execute_javascript':
    case 'debugger':
      return 'code';
    case 'write':
    case 'read':
    case 'edit':
    case 'list':
    case 'delete':
    case 'rename':
    case 'create_document':
      return 'files';
    case 'memory_search':
    case 'memory_get':
      return 'memory';
    case 'agents_list':
    case 'spawn_subagent':
    case 'list_subagents':
    case 'kill_subagent':
    case 'scheduler':
      return 'agents';
    default:
      if (/^(gmail|calendar|drive)_/.test(toolName)) return 'google';
      if (toolName.startsWith('browser_')) return 'browser';
      return 'other';
  }
};

/** Icon shown next to a tool call, grouped roughly by tool category. */
const getToolIcon = (toolName: string): LucideIcon => {
  switch (toolName) {
    case 'web_search':
      return SearchIcon;
    case 'web_fetch':
      return GlobeIcon;
    case 'browser':
      return AppWindowIcon;
    case 'execute_javascript':
      return TerminalIcon;
    case 'debugger':
      return BugIcon;
    case 'create_document':
      return FileTextIcon;
    case 'deep_research':
      return SearchIcon;
    case 'memory_search':
    case 'memory_get':
      return FileIcon;
    case 'scheduler':
      return ClockIcon;
    case 'agents_list':
    case 'spawn_subagent':
    case 'list_subagents':
    case 'kill_subagent':
      return BotIcon;
    case 'gmail_search':
    case 'gmail_read':
    case 'gmail_send':
    case 'gmail_draft':
      return MailIcon;
    case 'calendar_list':
    case 'calendar_create':
    case 'calendar_update':
    case 'calendar_delete':
      return CalendarIcon;
    case 'drive_search':
    case 'drive_read':
    case 'drive_create':
      return HardDriveIcon;
    case 'write':
    case 'read':
    case 'edit':
    case 'list':
    case 'delete':
    case 'rename':
      return FolderIcon;
    default:
      if (
        toolName.startsWith('browser_') ||
        toolName.includes('click') ||
        toolName.includes('type')
      ) {
        return MousePointerClickIcon;
      }
      if (toolName.includes('image') || toolName.includes('screenshot')) {
        return ImageIcon;
      }
      if (toolName.includes('code') || toolName.includes('execute')) {
        return CodeIcon;
      }
      return WrenchIcon;
  }
};

/** Best-effort hostname extraction, tolerant of missing protocol / invalid URLs. */
const hostnameOf = (url: unknown): string => {
  if (typeof url !== 'string' || !url) return '';
  try {
    return new URL(url).hostname;
  } catch {
    try {
      return new URL(`https://${url}`).hostname;
    } catch {
      return url;
    }
  }
};

const truncate = (text: string, max: number): string =>
  text.length > max ? `${text.slice(0, max - 1).trimEnd()}…` : text;

/** First non-empty line of a string, truncated for one-line display. */
const firstLine = (text: string, max = 90): string => {
  const line = text.split('\n').find(l => l.trim().length > 0) ?? text;
  return truncate(line.trim(), max);
};

const BROWSER_ACTION_RUNNING_LABEL: Record<string, string> = {
  tabs: 'Listing tabs',
  open: 'Opening tab',
  close: 'Closing tab',
  focus: 'Focusing tab',
  navigate: 'Navigating',
  content: 'Reading page content',
  snapshot: 'Reading page structure',
  screenshot: 'Taking screenshot',
  click: 'Clicking element',
  type: 'Typing text',
  select: 'Selecting option',
  scroll: 'Scrolling page',
  wait: 'Waiting',
  console: 'Reading console logs',
  network: 'Reading network log',
  group_tabs: 'Grouping tabs',
  ungroup_tabs: 'Ungrouping tabs',
  list_tab_groups: 'Listing tab groups',
  update_tab_group: 'Updating tab group',
};

/**
 * A one-line, human-readable summary of a tool call for the collapsed header.
 * Prefers the tool's own returned message (already human-readable for most
 * tools) and only special-cases the few tools that return structured data.
 */
const summarizeToolCall = (
  toolName: string,
  args: Record<string, unknown> | undefined,
  result: unknown,
  state: ToolPartState | undefined,
): string => {
  const isRunning = state === 'input-streaming' || state === 'input-available';

  if (toolName === 'web_search') {
    const query = typeof args?.query === 'string' ? args.query : '';
    if (isRunning) return query ? `Searching “${truncate(query, 60)}”` : 'Searching the web';
    const count = Array.isArray(result) ? result.length : undefined;
    return query
      ? `Searched “${truncate(query, 60)}”${count != null ? ` — ${count} results` : ''}`
      : 'Web search';
  }

  if (toolName === 'web_fetch') {
    const host = hostnameOf(args?.url);
    if (isRunning) return host ? `Fetching ${host}` : 'Fetching URL';
    if (result && typeof result === 'object') {
      const r = result as { title?: string; status?: number; error?: string };
      if (r.error) return `Fetch failed: ${host || 'URL'}`;
      return r.title ? `Fetched “${truncate(r.title, 60)}” — ${host}` : `Fetched ${host}`;
    }
    return host ? `Fetched ${host}` : 'Fetch URL';
  }

  if (toolName === 'browser') {
    const action = typeof args?.action === 'string' ? args.action : '';
    if (isRunning) return BROWSER_ACTION_RUNNING_LABEL[action] ?? 'Controlling browser';
    if (typeof result === 'string') return firstLine(result);
    return BROWSER_ACTION_RUNNING_LABEL[action] ?? 'Browser action';
  }

  if (toolName === 'execute_javascript') {
    const action = typeof args?.action === 'string' ? args.action : 'execute';
    if (isRunning) return action === 'execute' ? 'Running JavaScript' : `Running ${action}`;
    if (typeof result === 'string') return firstLine(result);
    return 'Executed JavaScript';
  }

  if (isRunning) {
    return `Running ${toolName}`;
  }

  if (typeof result === 'string' && result.trim()) {
    return firstLine(result);
  }
  if (Array.isArray(result)) {
    return `Returned ${result.length} item${result.length === 1 ? '' : 's'}`;
  }
  if (result && typeof result === 'object') {
    const r = result as Record<string, unknown>;
    for (const key of ['title', 'summary', 'message', 'text', 'name']) {
      if (typeof r[key] === 'string' && r[key]) return firstLine(r[key] as string);
    }
  }
  return toolName;
};

export { getToolCategory, getToolIcon, summarizeToolCall, hostnameOf, firstLine, truncate };
export type { ToolCategory };
