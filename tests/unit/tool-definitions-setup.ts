import { vi, beforeEach } from 'vitest';
import type { ToolConfig } from '../../packages/storage/lib/index.js';
/**
 * Tests for tools/index.ts — getAgentTools, executeTool.
 */

// ── Chrome API mocks (required by browser.ts module-level listeners) ──
Object.defineProperty(globalThis, 'chrome', {
  value: {
    debugger: {
      onDetach: { addListener: vi.fn() },
      onEvent: { addListener: vi.fn() },
    },
    tabs: {
      onRemoved: { addListener: vi.fn() },
      onUpdated: { addListener: vi.fn() },
    },
    runtime: { lastError: undefined },
  },
  writable: true,
  configurable: true,
});

// ── Storage mock ──
const defaultConfig = {
  enabledTools: {
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
    deep_research: false,
  },
  webSearchConfig: {
    provider: 'server' as const,
    browser: { engine: 'google' as const },
  },
};
let currentConfig: ToolConfig = JSON.parse(JSON.stringify(defaultConfig));

vi.mock('@extension/storage', () => ({
  toolConfigStorage: {
    get: vi.fn(() => Promise.resolve(currentConfig)),
    set: vi.fn((config: typeof currentConfig) => {
      currentConfig = config;
      return Promise.resolve();
    }),
  },
  logConfigStorage: {
    get: vi.fn(() => Promise.resolve({ enabled: false, level: 'info' })),
    subscribe: vi.fn(),
  },
  activeAgentStorage: {
    get: vi.fn(() => Promise.resolve('')),
    set: vi.fn(),
    getSnapshot: vi.fn(),
    subscribe: vi.fn(),
  },
  getAgent: vi.fn(() => Promise.resolve(undefined)),
}));

// ── Mock tool executors ──

// Helper to build minimal ToolRegistration mocks
const mockToolDef = (name: string, schema: object, execute: (...args: unknown[]) => unknown) => ({
  name,
  label: name,
  description: `Mock ${name}`,
  schema,
  execute,
});

vi.mock('../../chrome-extension/src/background/tools/tool-registration', () => {
  const jsonFormatResult = (result: unknown) => ({
    content: [{ type: 'text', text: JSON.stringify(result) }],
    details: result,
  });
  return {
    defaultFormatResult: (result: unknown) => {
      const text = typeof result === 'string' ? result : JSON.stringify(result);
      return { content: [{ type: 'text', text }], details: { output: result } };
    },
    jsonFormatResult,
  };
});

vi.mock('../../chrome-extension/src/background/tools/web-search', () => {
  const schema = {};
  const execute = vi.fn(() => Promise.resolve({ results: [] }));
  const jsonFmt = (result: unknown) => ({
    content: [{ type: 'text', text: JSON.stringify(result) }],
    details: result,
  });
  return {
    webSearchSchema: schema,
    executeWebSearch: execute,
    webSearchToolDef: { ...mockToolDef('web_search', schema, execute), formatResult: jsonFmt },
  };
});

vi.mock('../../chrome-extension/src/background/tools/documents', () => {
  const schema = {};
  const execute = vi.fn(() =>
    Promise.resolve({ id: 'doc-1', title: 'Test', kind: 'text', content: 'Hello world' }),
  );
  return {
    createDocumentSchema: schema,
    executeCreateDocument: execute,
    createDocumentToolDef: mockToolDef('create_document', schema, execute),
  };
});

vi.mock('../../chrome-extension/src/background/tools/workspace', () => {
  const writeSchema = {};
  const executeWrite = vi.fn(() => Promise.resolve({ success: true }));
  const readSchema = {};
  const executeRead = vi.fn(() => Promise.resolve({ content: 'hello' }));
  const editSchema = {};
  const executeEdit = vi.fn(() => Promise.resolve('Edited file.md (100 chars)'));
  const listSchema = {};
  const executeList = vi.fn(() => Promise.resolve([]));
  const deleteSchema = {};
  const executeDelete = vi.fn(() => Promise.resolve('Deleted test.md'));
  const renameSchema = {};
  const executeRename = vi.fn(() => Promise.resolve('Renamed old.md → new.md'));
  return {
    writeSchema,
    executeWrite,
    readSchema,
    executeRead,
    editSchema,
    executeEdit,
    listSchema,
    executeList,
    deleteSchema,
    executeDelete,
    renameSchema,
    executeRename,
    workspaceToolDefs: [
      mockToolDef('write', writeSchema, executeWrite),
      mockToolDef('read', readSchema, executeRead),
      mockToolDef('edit', editSchema, executeEdit),
      mockToolDef('list', listSchema, executeList),
      mockToolDef('delete', deleteSchema, executeDelete),
      mockToolDef('rename', renameSchema, executeRename),
    ],
  };
});

vi.mock('../../chrome-extension/src/background/tools/memory-tools', () => {
  const memorySearchSchema = {};
  const executeMemorySearch = vi.fn(() => Promise.resolve({ results: [] }));
  const memoryGetSchema = {};
  const executeMemoryGet = vi.fn(() => Promise.resolve({ content: '' }));
  return {
    memorySearchSchema,
    executeMemorySearch,
    memoryGetSchema,
    executeMemoryGet,
    memoryToolDefs: [
      mockToolDef('memory_search', memorySearchSchema, executeMemorySearch),
      mockToolDef('memory_get', memoryGetSchema, executeMemoryGet),
    ],
  };
});

vi.mock('../../chrome-extension/src/background/tools/browser', () => {
  const schema = {};
  const execute = vi.fn(() => Promise.resolve({ status: 'ok' }));
  return {
    browserSchema: schema,
    executeBrowser: execute,
    browserToolDef: mockToolDef('browser', schema, execute),
  };
});

vi.mock('../../chrome-extension/src/background/tools/scheduler', () => {
  const schema = {};
  const execute = vi.fn(() => Promise.resolve({ ok: true }));
  return {
    schedulerSchema: schema,
    executeScheduler: execute,
    schedulerToolDef: {
      ...mockToolDef('scheduler', schema, execute),
      excludeInHeadless: true,
      needsContext: true,
    },
  };
});

vi.mock('../../chrome-extension/src/background/tools/web-fetch', () => {
  const schema = {};
  const execute = vi.fn(() => Promise.resolve({ text: 'content', title: 'Title', status: 200 }));
  return {
    webFetchSchema: schema,
    executeWebFetch: execute,
    webFetchToolDef: mockToolDef('web_fetch', schema, execute),
  };
});

vi.mock('../../chrome-extension/src/background/tools/deep-research', () => {
  const schema = {};
  const execute = vi.fn(() => Promise.resolve('{}'));
  return {
    deepResearchSchema: schema,
    executeDeepResearch: execute,
    deepResearchToolDef: {
      ...mockToolDef('deep_research', schema, execute),
      excludeInHeadless: true,
      needsContext: true,
    },
  };
});

vi.mock('../../chrome-extension/src/background/tools/agents-list', () => {
  const schema = {};
  const execute = vi.fn(() => Promise.resolve('agents list result'));
  return {
    agentsListSchema: schema,
    executeAgentsList: execute,
    agentsListToolDef: { ...mockToolDef('agents_list', schema, execute), excludeInHeadless: true },
  };
});

vi.mock('../../chrome-extension/src/background/tools/execute-js', () => {
  const schema = {};
  const execute = vi.fn(() => Promise.resolve('result'));
  return {
    executeJsSchema: schema,
    executeJs: execute,
    executeCustomTool: vi.fn(() => Promise.resolve('custom result')),
    executeJsToolDef: mockToolDef('execute_javascript', schema, execute),
  };
});

vi.mock('../../chrome-extension/src/background/tools/subagent', () => {
  const spawnSubagentSchema = {};
  const listSubagentsSchema = {};
  const killSubagentSchema = {};
  const executeSpawnSubagent = vi.fn(() => Promise.resolve('{}'));
  const executeListSubagents = vi.fn(() => Promise.resolve('{"count":0,"runs":[]}'));
  const executeKillSubagent = vi.fn(() => Promise.resolve('{"status":"ok"}'));
  return {
    spawnSubagentSchema,
    listSubagentsSchema,
    killSubagentSchema,
    executeSpawnSubagent,
    executeListSubagents,
    executeKillSubagent,
    subagentToolDefs: [
      {
        ...mockToolDef('spawn_subagent', spawnSubagentSchema, executeSpawnSubagent),
        excludeInHeadless: true,
        needsContext: true,
      },
      {
        ...mockToolDef('list_subagents', listSubagentsSchema, executeListSubagents),
        excludeInHeadless: true,
      },
      {
        ...mockToolDef('kill_subagent', killSubagentSchema, executeKillSubagent),
        excludeInHeadless: true,
      },
    ],
  };
});

vi.mock('../../chrome-extension/src/background/tools/google-gmail', () => {
  const gmailSearchSchema = {};
  const gmailReadSchema = {};
  const gmailSendSchema = {};
  const gmailDraftSchema = {};
  const executeGmailSearch = vi.fn(() => Promise.resolve({ messages: [], totalEstimate: 0 }));
  const executeGmailRead = vi.fn(() => Promise.resolve({ id: 'msg1', body: '' }));
  const executeGmailSend = vi.fn(() => Promise.resolve({ id: 'sent1', status: 'sent' }));
  const executeGmailDraft = vi.fn(() =>
    Promise.resolve({ draftId: 'd1', status: 'draft_created' }),
  );
  const jsonFmt = (result: unknown) => ({
    content: [{ type: 'text', text: JSON.stringify(result) }],
    details: result,
  });
  return {
    gmailSearchSchema,
    gmailReadSchema,
    gmailSendSchema,
    gmailDraftSchema,
    executeGmailSearch,
    executeGmailRead,
    executeGmailSend,
    executeGmailDraft,
    gmailToolDefs: [
      {
        ...mockToolDef('gmail_search', gmailSearchSchema, executeGmailSearch),
        formatResult: jsonFmt,
      },
      { ...mockToolDef('gmail_read', gmailReadSchema, executeGmailRead), formatResult: jsonFmt },
      { ...mockToolDef('gmail_send', gmailSendSchema, executeGmailSend), formatResult: jsonFmt },
      { ...mockToolDef('gmail_draft', gmailDraftSchema, executeGmailDraft), formatResult: jsonFmt },
    ],
  };
});

vi.mock('../../chrome-extension/src/background/tools/google-calendar', () => {
  const calendarListSchema = {};
  const calendarCreateSchema = {};
  const calendarUpdateSchema = {};
  const calendarDeleteSchema = {};
  const executeCalendarList = vi.fn(() => Promise.resolve({ events: [] }));
  const executeCalendarCreate = vi.fn(() => Promise.resolve({ id: 'evt1', status: 'created' }));
  const executeCalendarUpdate = vi.fn(() => Promise.resolve({ id: 'evt1', status: 'updated' }));
  const executeCalendarDelete = vi.fn(() =>
    Promise.resolve({ eventId: 'evt1', status: 'deleted' }),
  );
  const jsonFmt = (result: unknown) => ({
    content: [{ type: 'text', text: JSON.stringify(result) }],
    details: result,
  });
  return {
    calendarListSchema,
    calendarCreateSchema,
    calendarUpdateSchema,
    calendarDeleteSchema,
    executeCalendarList,
    executeCalendarCreate,
    executeCalendarUpdate,
    executeCalendarDelete,
    calendarToolDefs: [
      {
        ...mockToolDef('calendar_list', calendarListSchema, executeCalendarList),
        formatResult: jsonFmt,
      },
      {
        ...mockToolDef('calendar_create', calendarCreateSchema, executeCalendarCreate),
        formatResult: jsonFmt,
      },
      {
        ...mockToolDef('calendar_update', calendarUpdateSchema, executeCalendarUpdate),
        formatResult: jsonFmt,
      },
      {
        ...mockToolDef('calendar_delete', calendarDeleteSchema, executeCalendarDelete),
        formatResult: jsonFmt,
      },
    ],
  };
});

vi.mock('../../chrome-extension/src/background/tools/google-drive', () => {
  const driveSearchSchema = {};
  const driveReadSchema = {};
  const driveCreateSchema = {};
  const executeDriveSearch = vi.fn(() => Promise.resolve({ files: [] }));
  const executeDriveRead = vi.fn(() => Promise.resolve({ id: 'f1', content: '' }));
  const executeDriveCreate = vi.fn(() => Promise.resolve({ id: 'f1', status: 'created' }));
  const jsonFmt = (result: unknown) => ({
    content: [{ type: 'text', text: JSON.stringify(result) }],
    details: result,
  });
  return {
    driveSearchSchema,
    driveReadSchema,
    driveCreateSchema,
    executeDriveSearch,
    executeDriveRead,
    executeDriveCreate,
    driveToolDefs: [
      {
        ...mockToolDef('drive_search', driveSearchSchema, executeDriveSearch),
        formatResult: jsonFmt,
      },
      { ...mockToolDef('drive_read', driveReadSchema, executeDriveRead), formatResult: jsonFmt },
      {
        ...mockToolDef('drive_create', driveCreateSchema, executeDriveCreate),
        formatResult: jsonFmt,
      },
    ],
  };
});

vi.mock('../../chrome-extension/src/background/tools/debugger', () => {
  const schema = {};
  const execute = vi.fn(() => Promise.resolve('debugger result'));
  return {
    debuggerSchema: schema,
    executeDebugger: execute,
    debuggerToolDef: mockToolDef('debugger', schema, execute),
  };
});

// ── Mock tool-utils ──
vi.mock('../../chrome-extension/src/background/tools/tool-utils', () => ({
  getActiveAgentId: vi.fn(() => Promise.resolve(undefined)),
  getWorkspaceFile: vi.fn(() => Promise.resolve(undefined)),
}));

beforeEach(() => {
  vi.clearAllMocks();
  currentConfig = JSON.parse(JSON.stringify(defaultConfig));
});

export { currentConfig, defaultConfig };
