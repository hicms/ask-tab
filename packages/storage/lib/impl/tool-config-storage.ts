import { createStorage, StorageEnum } from '../base/index.js';

/** `server` relays through the AskTab server, which holds the search provider credentials. */
type WebSearchProvider = 'server' | 'browser';
type BrowserSearchEngine = 'google' | 'bing' | 'duckduckgo';

interface WebSearchProviderConfig {
  provider: WebSearchProvider;
  browser: { engine: BrowserSearchEngine };
}

interface DeepResearchConfig {
  maxSources: number;
  maxIterations: number;
  maxDepth: number;
  timeoutMs: number;
}

interface ToolConfig {
  enabledTools: Record<string, boolean>;
  webSearchConfig: WebSearchProviderConfig;
  deepResearchConfig?: DeepResearchConfig;
  /** User-provided Google OAuth client ID. When set, tools use launchWebAuthFlow instead of getAuthToken. */
  googleClientId?: string;
}

const defaultWebSearchConfig: WebSearchProviderConfig = {
  provider: 'server',
  browser: { engine: 'google' },
};

const createAgentToolConfig = (): ToolConfig => ({
  enabledTools: {},
  webSearchConfig: {
    ...defaultWebSearchConfig,
    browser: { ...defaultWebSearchConfig.browser },
  },
});

const defaultDeepResearchConfig: DeepResearchConfig = {
  maxSources: 5,
  maxIterations: 2,
  maxDepth: 3,
  timeoutMs: 120_000,
};

/**
 * Default enabledTools values keyed by individual tool name.
 * Must stay in sync with toolRegistryMeta in @extension/shared.
 * Defined here locally to avoid circular dependency (shared depends on storage).
 */
const defaultEnabledTools: Record<string, boolean> = {
  web_search: true,
  web_fetch: true,
  create_document: true,
  browser: true,
  write: true,
  read: true,
  edit: true,
  list: true,
  delete: true,
  rename: true,
  memory_search: true,
  memory_get: true,
  scheduler: true,
  chat_list: true,
  chat_history: true,
  chat_send: true,
  chat_spawn: true,
  chat_status: true,
  agents_list: true,
  deep_research: true,
  spawn_subagent: true,
  list_subagents: true,
  kill_subagent: true,
  execute_javascript: true,
  gmail_search: false,
  gmail_read: false,
  gmail_send: false,
  gmail_draft: false,
  calendar_list: false,
  calendar_create: false,
  calendar_update: false,
  calendar_delete: false,
  drive_search: false,
  drive_read: false,
  drive_create: false,
};

const defaultToolConfig: ToolConfig = {
  enabledTools: { ...defaultEnabledTools },
  webSearchConfig: defaultWebSearchConfig,
};

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

const assertFields = (value: unknown, allowed: readonly string[], path: string): void => {
  if (!isRecord(value) || Object.keys(value).some(key => !allowed.includes(key))) {
    throw new Error(`Invalid tool configuration: ${path}`);
  }
};

/** Reject fields outside the current shape before they can enter storage or a backup. */
const assertToolConfig: (value: unknown) => asserts value is ToolConfig = value => {
  assertFields(
    value,
    ['enabledTools', 'webSearchConfig', 'deepResearchConfig', 'googleClientId'],
    'root',
  );
  const config = value as Record<string, unknown>;
  if (
    !isRecord(config.enabledTools) ||
    Object.values(config.enabledTools).some(v => typeof v !== 'boolean')
  ) {
    throw new Error('Invalid tool configuration: enabledTools');
  }
  assertFields(config.webSearchConfig, ['provider', 'browser'], 'webSearchConfig');
  const search = config.webSearchConfig as Record<string, unknown>;
  if (search.provider !== 'server' && search.provider !== 'browser') {
    throw new Error('Invalid tool configuration: webSearchConfig.provider');
  }
  assertFields(search.browser, ['engine'], 'webSearchConfig.browser');
  const browser = search.browser as Record<string, unknown>;
  if (!['google', 'bing', 'duckduckgo'].includes(String(browser.engine))) {
    throw new Error('Invalid tool configuration: webSearchConfig.browser.engine');
  }
  if (config.deepResearchConfig !== undefined) {
    assertFields(
      config.deepResearchConfig,
      ['maxSources', 'maxIterations', 'maxDepth', 'timeoutMs'],
      'deepResearchConfig',
    );
    if (
      Object.values(config.deepResearchConfig as Record<string, unknown>).some(
        v => typeof v !== 'number' || !Number.isFinite(v),
      )
    ) {
      throw new Error('Invalid tool configuration: deepResearchConfig');
    }
  }
  if (config.googleClientId !== undefined && typeof config.googleClientId !== 'string') {
    throw new Error('Invalid tool configuration: googleClientId');
  }
};

const rawToolConfigStorage = createStorage<ToolConfig>('tool-config', defaultToolConfig, {
  storageEnum: StorageEnum.Local,
  liveUpdate: true,
});

const toolConfigStorage = {
  get: async (): Promise<ToolConfig> => {
    const stored = await rawToolConfigStorage.get();
    assertToolConfig(stored);
    return {
      enabledTools: { ...defaultEnabledTools, ...stored.enabledTools },
      webSearchConfig: stored.webSearchConfig,
      deepResearchConfig: { ...defaultDeepResearchConfig, ...stored.deepResearchConfig },
      ...(stored.googleClientId ? { googleClientId: stored.googleClientId } : {}),
    };
  },
  set: async (value: ToolConfig): Promise<void> => {
    assertToolConfig(value);
    await rawToolConfigStorage.set(value);
  },
  getSnapshot: rawToolConfigStorage.getSnapshot.bind(rawToolConfigStorage),
  subscribe: rawToolConfigStorage.subscribe.bind(rawToolConfigStorage),
};

export type {
  ToolConfig,
  WebSearchProvider,
  BrowserSearchEngine,
  WebSearchProviderConfig,
  DeepResearchConfig,
};
export {
  toolConfigStorage,
  defaultWebSearchConfig,
  defaultDeepResearchConfig,
  createAgentToolConfig,
  assertToolConfig,
};
