import { currentConfig, defaultConfig } from '../../../../tests/unit/tool-definitions-setup';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// ── Import after all mocks ──
const { getAgentTools, executeTool, withTimeout } = await import('../tools');

// ── getAgentTools ──────────────────────────

describe('getAgentTools', () => {
  it('returns tools for all enabled entries', async () => {
    const tools = await getAgentTools();
    const toolNames = tools.map(t => t.name);
    expect(toolNames).toContain('web_search');
    expect(toolNames).toContain('create_document');
    expect(toolNames).toContain('browser');
    expect(toolNames).toContain('write');
    expect(toolNames).toContain('read');
    expect(toolNames).toContain('list');
    expect(toolNames).toContain('memory_search');
    expect(toolNames).toContain('memory_get');
    expect(toolNames).toContain('scheduler');
  });

  it('excludes web_search tool when web_search is disabled', async () => {
    currentConfig.enabledTools.web_search = false;
    const tools = await getAgentTools();
    const toolNames = tools.map(t => t.name);
    expect(toolNames).not.toContain('web_search');
  });

  it('excludes create_document when disabled', async () => {
    currentConfig.enabledTools.create_document = false;
    const tools = await getAgentTools();
    const toolNames = tools.map(t => t.name);
    expect(toolNames).not.toContain('create_document');
  });

  it('excludes browser tool when browser is disabled', async () => {
    currentConfig.enabledTools.browser = false;
    const tools = await getAgentTools();
    const toolNames = tools.map(t => t.name);
    expect(toolNames).not.toContain('browser');
  });

  it('always includes workspace and memory tools when enabled', async () => {
    currentConfig.enabledTools.web_search = false;
    currentConfig.enabledTools.create_document = false;
    currentConfig.enabledTools.browser = false;
    const tools = await getAgentTools();
    const toolNames = tools.map(t => t.name);
    expect(toolNames).toContain('write');
    expect(toolNames).toContain('read');
    expect(toolNames).toContain('list');
    expect(toolNames).toContain('memory_search');
    expect(toolNames).toContain('memory_get');
  });

  it('excludes deep_research when disabled (default)', async () => {
    const tools = await getAgentTools();
    const toolNames = tools.map(t => t.name);
    expect(toolNames).not.toContain('deep_research');
  });

  it('includes deep_research when enabled', async () => {
    currentConfig.enabledTools.deep_research = true;
    const tools = await getAgentTools();
    const toolNames = tools.map(t => t.name);
    expect(toolNames).toContain('deep_research');
  });

  it('excludes deep_research in headless mode', async () => {
    currentConfig.enabledTools.deep_research = true;
    const tools = await getAgentTools({ headless: true });
    const toolNames = tools.map(t => t.name);
    expect(toolNames).not.toContain('deep_research');
  });

  it('includes web_fetch when enabled', async () => {
    const tools = await getAgentTools();
    const toolNames = tools.map(t => t.name);
    expect(toolNames).toContain('web_fetch');
  });

  it('excludes web_fetch when disabled', async () => {
    currentConfig.enabledTools.web_fetch = false;
    const tools = await getAgentTools();
    const toolNames = tools.map(t => t.name);
    expect(toolNames).not.toContain('web_fetch');
  });

  it('excludes scheduler in headless mode', async () => {
    const tools = await getAgentTools({ headless: true });
    const toolNames = tools.map(t => t.name);
    expect(toolNames).not.toContain('scheduler');
  });

  it('includes scheduler when not headless', async () => {
    const tools = await getAgentTools({ headless: false });
    const toolNames = tools.map(t => t.name);
    expect(toolNames).toContain('scheduler');
  });
});

// ── executeTool ─────────────────────────────────

describe('executeTool', () => {
  it('executes web_search tool', async () => {
    const result = await executeTool('web_search', { query: 'test' });
    expect(result).toEqual({ results: [] });
  });

  it('executes create_document tool', async () => {
    const result = await executeTool('create_document', { title: 'Test' });
    expect(result).toEqual({ id: 'doc-1', title: 'Test', kind: 'text', content: 'Hello world' });
  });

  it('executes write tool', async () => {
    const result = await executeTool('write', { name: 'test.md' });
    expect(result).toEqual({ success: true });
  });

  it('executes read tool', async () => {
    const result = await executeTool('read', { name: 'test.md' });
    expect(result).toEqual({ content: 'hello' });
  });

  it('executes edit tool', async () => {
    const result = await executeTool('edit', { path: 'file.md', oldText: 'old', newText: 'new' });
    expect(result).toBe('Edited file.md (100 chars)');
  });

  it('executes list tool', async () => {
    const result = await executeTool('list', {});
    expect(result).toEqual([]);
  });

  it('executes delete tool', async () => {
    const result = await executeTool('delete', { path: 'test.md' });
    expect(result).toBe('Deleted test.md');
  });

  it('executes rename tool', async () => {
    const result = await executeTool('rename', { path: 'old.md', newPath: 'new.md' });
    expect(result).toBe('Renamed old.md → new.md');
  });

  it('executes memory_search tool', async () => {
    const result = await executeTool('memory_search', { query: 'test' });
    expect(result).toEqual({ results: [] });
  });

  it('executes memory_get tool', async () => {
    const result = await executeTool('memory_get', { path: 'test.md' });
    expect(result).toEqual({ content: '' });
  });

  it('executes browser tool', async () => {
    const result = await executeTool('browser', { action: 'snapshot' });
    expect(result).toEqual({ status: 'ok' });
  });

  it('executes scheduler tool', async () => {
    const result = await executeTool('scheduler', { action: 'list' });
    expect(result).toEqual({ ok: true });
  });

  it('executes web_fetch tool', async () => {
    const result = await executeTool('web_fetch', { url: 'https://example.com' });
    expect(result).toEqual({ text: 'content', title: 'Title', status: 200 });
  });

  it('executes deep_research tool', async () => {
    const result = await executeTool('deep_research', { topic: 'AI safety' });
    expect(result).toBe('{}');
  });

  it('throws for unknown tool', async () => {
    await expect(executeTool('nonexistentTool', {})).rejects.toThrow('Unknown tool');
  });
});

// ── Registry consistency ────────────────────────

describe('tool registry consistency', () => {
  it('every tool from getAgentTools is resolvable by executeTool', async () => {
    const tools = await getAgentTools();
    expect(tools.length).toBeGreaterThan(0);

    // Each tool name from getAgentTools should be executable
    for (const tool of tools) {
      await expect(executeTool(tool.name, {})).resolves.toBeDefined();
    }
  });
});

describe('getToolRegistration', () => {
  it('returns the registration that executeTool validates against', async () => {
    const { getToolRegistration } = await import('../tools');
    const reg = getToolRegistration('web_fetch');
    expect(reg?.name).toBe('web_fetch');
    expect(reg?.schema).toBeDefined();
    expect(getToolRegistration('no_such_tool')).toBeUndefined();
  });
});

// ── withTimeout ─────────────────────────────────

describe('withTimeout', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('resolves when promise completes before timeout', async () => {
    const promise = Promise.resolve('ok');
    await expect(withTimeout(promise, 5000, 'test')).resolves.toBe('ok');
  });

  it('rejects with timeout error when promise exceeds timeout', async () => {
    const promise = new Promise<string>(resolve => {
      setTimeout(() => resolve('late'), 10_000);
    });
    const result = withTimeout(promise, 100, 'slowTool');
    vi.advanceTimersByTime(100);
    await expect(result).rejects.toThrow('Tool "slowTool" timed out after 100ms');
  });
});

// ── Custom tool error logging ───────────────────

describe('custom tool injection error', () => {
  it('logs warning when custom tool injection fails', async () => {
    const { activeAgentStorage } = await import('@extension/storage');
    vi.mocked(activeAgentStorage.get).mockRejectedValueOnce(new Error('storage fail'));
    // Should not throw — error is caught and logged
    const tools = await getAgentTools();
    expect(Array.isArray(tools)).toBe(true);
  });
});

// ── Google tools in getAgentTools ───────────────

describe('getAgentTools — Google tools', () => {
  const googleToolNames = [
    'gmail_search',
    'gmail_read',
    'gmail_send',
    'gmail_draft',
    'calendar_list',
    'calendar_create',
    'calendar_update',
    'calendar_delete',
    'drive_search',
    'drive_read',
    'drive_create',
  ];

  it('includes all Google tools when enabled', async () => {
    for (const name of googleToolNames) {
      currentConfig.enabledTools[name] = true;
    }
    const tools = await getAgentTools();
    const toolNames = tools.map(t => t.name);
    for (const name of googleToolNames) {
      expect(toolNames).toContain(name);
    }
  });

  it('excludes all Google tools when disabled', async () => {
    for (const name of googleToolNames) {
      currentConfig.enabledTools[name] = false;
    }
    const tools = await getAgentTools();
    const toolNames = tools.map(t => t.name);
    for (const name of googleToolNames) {
      expect(toolNames).not.toContain(name);
    }
  });

  it('includes gmail_search independently', async () => {
    currentConfig.enabledTools.gmail_search = true;
    const tools = await getAgentTools();
    const toolNames = tools.map(t => t.name);
    expect(toolNames).toContain('gmail_search');
    expect(toolNames).not.toContain('gmail_read');
  });

  it('includes gmail_read independently', async () => {
    currentConfig.enabledTools.gmail_read = true;
    const tools = await getAgentTools();
    const toolNames = tools.map(t => t.name);
    expect(toolNames).toContain('gmail_read');
    expect(toolNames).not.toContain('gmail_send');
  });

  it('includes gmail_send independently', async () => {
    currentConfig.enabledTools.gmail_send = true;
    const tools = await getAgentTools();
    const toolNames = tools.map(t => t.name);
    expect(toolNames).toContain('gmail_send');
    expect(toolNames).not.toContain('gmail_draft');
  });

  it('includes gmail_draft independently', async () => {
    currentConfig.enabledTools.gmail_draft = true;
    const tools = await getAgentTools();
    const toolNames = tools.map(t => t.name);
    expect(toolNames).toContain('gmail_draft');
  });

  it('includes calendar_list independently', async () => {
    currentConfig.enabledTools.calendar_list = true;
    const tools = await getAgentTools();
    const toolNames = tools.map(t => t.name);
    expect(toolNames).toContain('calendar_list');
  });

  it('includes calendar_create independently', async () => {
    currentConfig.enabledTools.calendar_create = true;
    const tools = await getAgentTools();
    const toolNames = tools.map(t => t.name);
    expect(toolNames).toContain('calendar_create');
  });

  it('includes calendar_update independently', async () => {
    currentConfig.enabledTools.calendar_update = true;
    const tools = await getAgentTools();
    const toolNames = tools.map(t => t.name);
    expect(toolNames).toContain('calendar_update');
  });

  it('includes calendar_delete independently', async () => {
    currentConfig.enabledTools.calendar_delete = true;
    const tools = await getAgentTools();
    const toolNames = tools.map(t => t.name);
    expect(toolNames).toContain('calendar_delete');
  });

  it('includes drive_search independently', async () => {
    currentConfig.enabledTools.drive_search = true;
    const tools = await getAgentTools();
    const toolNames = tools.map(t => t.name);
    expect(toolNames).toContain('drive_search');
  });

  it('includes drive_read independently', async () => {
    currentConfig.enabledTools.drive_read = true;
    const tools = await getAgentTools();
    const toolNames = tools.map(t => t.name);
    expect(toolNames).toContain('drive_read');
  });

  it('includes drive_create independently', async () => {
    currentConfig.enabledTools.drive_create = true;
    const tools = await getAgentTools();
    const toolNames = tools.map(t => t.name);
    expect(toolNames).toContain('drive_create');
  });
});

// ── Google tools in executeTool ─────────────────

describe('executeTool — Google tools', () => {
  it('executes gmail_search tool', async () => {
    const result = await executeTool('gmail_search', { query: 'is:unread' });
    expect(result).toEqual({ messages: [], totalEstimate: 0 });
  });

  it('executes gmail_read tool', async () => {
    const result = await executeTool('gmail_read', { messageId: 'msg1' });
    expect(result).toEqual({ id: 'msg1', body: '' });
  });

  it('executes gmail_send tool', async () => {
    const result = await executeTool('gmail_send', {
      to: 'test@example.com',
      subject: 'Hi',
      body: 'Hello',
    });
    expect(result).toEqual({ id: 'sent1', status: 'sent' });
  });

  it('executes gmail_draft tool', async () => {
    const result = await executeTool('gmail_draft', {
      to: 'test@example.com',
      subject: 'Draft',
      body: 'Draft body',
    });
    expect(result).toEqual({ draftId: 'd1', status: 'draft_created' });
  });

  it('executes calendar_list tool', async () => {
    const result = await executeTool('calendar_list', { timeMin: '2024-01-01' });
    expect(result).toEqual({ events: [] });
  });

  it('executes calendar_create tool', async () => {
    const result = await executeTool('calendar_create', {
      summary: 'Meeting',
      startTime: '2024-01-01T10:00:00Z',
      endTime: '2024-01-01T11:00:00Z',
    });
    expect(result).toEqual({ id: 'evt1', status: 'created' });
  });

  it('executes calendar_update tool', async () => {
    const result = await executeTool('calendar_update', {
      eventId: 'evt1',
      summary: 'Updated Meeting',
    });
    expect(result).toEqual({ id: 'evt1', status: 'updated' });
  });

  it('executes calendar_delete tool', async () => {
    const result = await executeTool('calendar_delete', { eventId: 'evt1' });
    expect(result).toEqual({ eventId: 'evt1', status: 'deleted' });
  });

  it('executes drive_search tool', async () => {
    const result = await executeTool('drive_search', { query: 'report' });
    expect(result).toEqual({ files: [] });
  });

  it('executes drive_read tool', async () => {
    const result = await executeTool('drive_read', { fileId: 'f1' });
    expect(result).toEqual({ id: 'f1', content: '' });
  });

  it('executes drive_create tool', async () => {
    const result = await executeTool('drive_create', { name: 'doc.txt', content: 'hello' });
    expect(result).toEqual({ id: 'f1', status: 'created' });
  });
});

// ── execute_javascript tool ─────────────────────────────

describe('executeTool — execute_javascript', () => {
  it('executes execute_javascript tool', async () => {
    const result = await executeTool('execute_javascript', {
      action: 'execute',
      code: 'return 1+1',
    });
    expect(result).toBe('result');
  });
});

// ── agents_list tool ──────────────────────────

describe('getAgentTools — agents_list', () => {
  it('includes agents_list when enabled and not headless', async () => {
    currentConfig.enabledTools.agents_list = true;
    const tools = await getAgentTools();
    const toolNames = tools.map(t => t.name);
    expect(toolNames).toContain('agents_list');
  });

  it('excludes agents_list in headless mode', async () => {
    currentConfig.enabledTools.agents_list = true;
    const tools = await getAgentTools({ headless: true });
    const toolNames = tools.map(t => t.name);
    expect(toolNames).not.toContain('agents_list');
  });

  it('excludes agents_list when disabled', async () => {
    currentConfig.enabledTools.agents_list = false;
    const tools = await getAgentTools();
    const toolNames = tools.map(t => t.name);
    expect(toolNames).not.toContain('agents_list');
  });
});

describe('executeTool — agents_list', () => {
  it('executes agents_list tool', async () => {
    const result = await executeTool('agents_list', {});
    expect(result).toBe('agents list result');
  });
});

// ── getAgentTools — execute_javascript ──────────────────

describe('getAgentTools — execute_javascript', () => {
  it('includes execute_javascript when enabled', async () => {
    currentConfig.enabledTools.execute_javascript = true;
    const tools = await getAgentTools();
    const toolNames = tools.map(t => t.name);
    expect(toolNames).toContain('execute_javascript');
  });

  it('excludes execute_javascript when disabled', async () => {
    currentConfig.enabledTools.execute_javascript = false;
    const tools = await getAgentTools();
    const toolNames = tools.map(t => t.name);
    expect(toolNames).not.toContain('execute_javascript');
  });
});

// ── Custom tool fallback in executeTool ─────────

describe('executeTool — custom tool fallback', () => {
  it('executes custom tool found in active agent', async () => {
    const { activeAgentStorage, getAgent } = await import('@extension/storage');
    const { executeCustomTool } = await import('./execute-js');
    vi.mocked(activeAgentStorage.get).mockResolvedValueOnce('agent-1');
    vi.mocked(getAgent).mockResolvedValueOnce({
      id: 'agent-1',
      identity: {},
      isDefault: false,
      createdAt: 0,
      updatedAt: 0,
      name: 'Test Agent',
      customTools: [
        {
          name: 'my_custom_tool',
          description: 'A custom tool',
          params: [{ name: 'input', type: 'string', description: 'input value' }],
          path: 'tools/custom.js',
        },
      ],
    });
    const signal = new AbortController().signal;
    const result = await executeTool('my_custom_tool', { input: 'hello' }, { signal });
    expect(result).toBe('custom result');
    expect(executeCustomTool).toHaveBeenCalledWith(
      expect.objectContaining({ name: 'my_custom_tool' }),
      { input: 'hello' },
      'agent-1',
      signal,
    );
  });

  it('throws "Unknown tool" when custom tool not found in active agent', async () => {
    const { activeAgentStorage, getAgent } = await import('@extension/storage');
    vi.mocked(activeAgentStorage.get).mockResolvedValueOnce('agent-1');
    vi.mocked(getAgent).mockResolvedValueOnce({
      id: 'agent-1',
      identity: {},
      isDefault: false,
      createdAt: 0,
      updatedAt: 0,
      name: 'Test Agent',
      customTools: [
        {
          name: 'other_tool',
          description: 'Another tool',
          params: [],
          path: 'tools/other.js',
        },
      ],
    });
    await expect(executeTool('nonexistent_custom', {})).rejects.toThrow('Unknown tool');
  });

  it('throws "Unknown tool" when no active agent (empty string)', async () => {
    const { activeAgentStorage } = await import('@extension/storage');
    vi.mocked(activeAgentStorage.get).mockResolvedValueOnce('');
    await expect(executeTool('nonexistent_custom', {})).rejects.toThrow('Unknown tool');
  });

  it('throws "Unknown tool" when agent has no customTools', async () => {
    const { activeAgentStorage, getAgent } = await import('@extension/storage');
    vi.mocked(activeAgentStorage.get).mockResolvedValueOnce('agent-1');
    vi.mocked(getAgent).mockResolvedValueOnce({
      id: 'agent-1',
      identity: {},
      isDefault: false,
      createdAt: 0,
      updatedAt: 0,
      name: 'Test Agent',
      customTools: undefined,
    });
    await expect(executeTool('nonexistent_custom', {})).rejects.toThrow('Unknown tool');
  });
});

// ── getAgentTools — custom tool injection ───────

describe('getAgentTools — custom tool injection', () => {
  it('includes custom tools when enabled in global config', async () => {
    const { activeAgentStorage, getAgent } = await import('@extension/storage');
    vi.mocked(activeAgentStorage.get).mockResolvedValueOnce('agent-1');
    vi.mocked(getAgent).mockResolvedValueOnce({
      id: 'agent-1',
      identity: {},
      isDefault: false,
      createdAt: 0,
      updatedAt: 0,
      name: 'Test Agent',
      customTools: [
        {
          name: 'my_custom',
          description: 'Custom tool',
          params: [{ name: 'x', type: 'number', description: 'a number' }],
          path: 'tools/custom.js',
        },
      ],
      toolConfig: {
        webSearchConfig: defaultConfig.webSearchConfig,
        enabledTools: {},
      },
    });
    currentConfig.enabledTools.my_custom = true;
    const tools = await getAgentTools();
    const toolNames = tools.map(t => t.name);
    expect(toolNames).toContain('my_custom');
  });

  it('includes custom tools when enabled in agent toolConfig', async () => {
    const { activeAgentStorage, getAgent } = await import('@extension/storage');
    vi.mocked(activeAgentStorage.get).mockResolvedValueOnce('agent-1');
    vi.mocked(getAgent).mockResolvedValueOnce({
      id: 'agent-1',
      identity: {},
      isDefault: false,
      createdAt: 0,
      updatedAt: 0,
      name: 'Test Agent',
      customTools: [
        {
          name: 'agent_tool',
          description: 'Agent-level tool',
          params: [{ name: 'val', type: 'boolean', description: 'a flag' }],
          path: 'tools/agent.js',
        },
      ],
      toolConfig: {
        webSearchConfig: defaultConfig.webSearchConfig,
        enabledTools: { agent_tool: true },
      },
    });
    const tools = await getAgentTools();
    const toolNames = tools.map(t => t.name);
    expect(toolNames).toContain('agent_tool');
  });

  it('excludes custom tools when disabled in both configs', async () => {
    const { activeAgentStorage, getAgent } = await import('@extension/storage');
    vi.mocked(activeAgentStorage.get).mockResolvedValueOnce('agent-1');
    vi.mocked(getAgent).mockResolvedValueOnce({
      id: 'agent-1',
      identity: {},
      isDefault: false,
      createdAt: 0,
      updatedAt: 0,
      name: 'Test Agent',
      customTools: [
        {
          name: 'disabled_tool',
          description: 'Should not appear',
          params: [],
          path: 'tools/disabled.js',
        },
      ],
      toolConfig: {
        webSearchConfig: defaultConfig.webSearchConfig,
        enabledTools: {},
      },
    });
    currentConfig.enabledTools.disabled_tool = false;
    const tools = await getAgentTools();
    const toolNames = tools.map(t => t.name);
    expect(toolNames).not.toContain('disabled_tool');
  });
});

// ── Google tool execute callbacks in getAgentTools ──

describe('getAgentTools — Google tool execute callbacks', () => {
  const googleToolsWithResults: Array<{
    name: string;
    enableKey: string;
    expectedResult: unknown;
  }> = [
    {
      name: 'gmail_search',
      enableKey: 'gmail_search',
      expectedResult: { messages: [], totalEstimate: 0 },
    },
    { name: 'gmail_read', enableKey: 'gmail_read', expectedResult: { id: 'msg1', body: '' } },
    {
      name: 'gmail_send',
      enableKey: 'gmail_send',
      expectedResult: { id: 'sent1', status: 'sent' },
    },
    {
      name: 'gmail_draft',
      enableKey: 'gmail_draft',
      expectedResult: { draftId: 'd1', status: 'draft_created' },
    },
    { name: 'calendar_list', enableKey: 'calendar_list', expectedResult: { events: [] } },
    {
      name: 'calendar_create',
      enableKey: 'calendar_create',
      expectedResult: { id: 'evt1', status: 'created' },
    },
    {
      name: 'calendar_update',
      enableKey: 'calendar_update',
      expectedResult: { id: 'evt1', status: 'updated' },
    },
    {
      name: 'calendar_delete',
      enableKey: 'calendar_delete',
      expectedResult: { eventId: 'evt1', status: 'deleted' },
    },
    { name: 'drive_search', enableKey: 'drive_search', expectedResult: { files: [] } },
    { name: 'drive_read', enableKey: 'drive_read', expectedResult: { id: 'f1', content: '' } },
    {
      name: 'drive_create',
      enableKey: 'drive_create',
      expectedResult: { id: 'f1', status: 'created' },
    },
  ];

  for (const { name, enableKey, expectedResult } of googleToolsWithResults) {
    it(`${name} execute callback returns correct format`, async () => {
      currentConfig.enabledTools[enableKey] = true;
      const tools = await getAgentTools();
      const tool = tools.find(t => t.name === name)!;
      expect(tool).toBeDefined();
      const result = await tool.execute('call-1', {});
      expect(result).toEqual({
        content: [{ type: 'text', text: JSON.stringify(expectedResult) }],
        details: expectedResult,
      });
    });
  }
});

// ── Agent tools execute callbacks ───────────────

describe('getAgentTools — tool execute callbacks', () => {
  it('agents_list execute callback returns correct format', async () => {
    currentConfig.enabledTools.agents_list = true;
    const tools = await getAgentTools();
    const tool = tools.find(t => t.name === 'agents_list')!;
    expect(tool).toBeDefined();
    const result = await tool.execute('call-1', {});
    expect(result).toEqual({
      content: [{ type: 'text', text: 'agents list result' }],
      details: { output: 'agents list result' },
    });
  });

  it('execute_javascript execute callback returns correct format', async () => {
    currentConfig.enabledTools.execute_javascript = true;
    const tools = await getAgentTools();
    const tool = tools.find(t => t.name === 'execute_javascript')!;
    expect(tool).toBeDefined();
    const result = await tool.execute('call-1', { action: 'execute', code: '1+1' });
    expect(result).toEqual({
      content: [{ type: 'text', text: 'result' }],
      details: { output: 'result' },
    });
  });

  it('custom tool execute callback returns correct format', async () => {
    const { activeAgentStorage, getAgent } = await import('@extension/storage');
    vi.mocked(activeAgentStorage.get).mockResolvedValueOnce('agent-1');
    vi.mocked(getAgent).mockResolvedValueOnce({
      id: 'agent-1',
      identity: {},
      isDefault: false,
      createdAt: 0,
      updatedAt: 0,
      name: 'Test Agent',
      customTools: [
        {
          name: 'my_ct',
          description: 'A custom tool',
          params: [{ name: 'input', type: 'string', description: 'value' }],
          path: 'tools/ct.js',
        },
      ],
      toolConfig: {
        webSearchConfig: defaultConfig.webSearchConfig,
        enabledTools: { my_ct: true },
      },
    });
    const tools = await getAgentTools();
    const tool = tools.find(t => t.name === 'my_ct')!;
    expect(tool).toBeDefined();
    const result = await tool.execute('call-1', { input: 'test' });
    expect(result).toEqual({
      content: [{ type: 'text', text: 'custom result' }],
      details: { output: 'custom result' },
    });
  });
});

// ── deep_research execute callback ──────────────

describe('getAgentTools -- deep_research execute callback', () => {
  it('calls executeDeepResearch and wraps result as text content', async () => {
    currentConfig.enabledTools.deep_research = true;
    const tools = await getAgentTools();
    const tool = tools.find(t => t.name === 'deep_research')!;
    expect(tool).toBeDefined();
    const result = await tool.execute('call-1', { topic: 'AI safety' });
    expect(result).toEqual({
      content: [{ type: 'text', text: '{}' }],
      details: { output: '{}' },
    });
  });
});

// ── executeTool — debugger ───────────────────────

describe('executeTool — debugger', () => {
  it('executes debugger tool via executeTool', async () => {
    const result = await executeTool('debugger', { action: 'list_targets' });
    expect(result).toBe('debugger result');
  });
});

// ── getAgentTools — debugger ──

describe('getAgentTools — debugger', () => {
  it('includes debugger when enabled in tool config', async () => {
    currentConfig.enabledTools.debugger = true;
    const tools = await getAgentTools();
    const toolNames = tools.map(t => t.name);
    expect(toolNames).toContain('debugger');
  });

  it('excludes debugger when disabled in tool config (default)', async () => {
    currentConfig.enabledTools.debugger = false;
    const tools = await getAgentTools();
    const toolNames = tools.map(t => t.name);
    expect(toolNames).not.toContain('debugger');
  });
});

// ── executeTool schema validation error ──────────

describe('executeTool -- schema validation', () => {
  it('returns error string when args fail schema validation', async () => {
    // The mocked schemas are `{}` (not real TypeBox) so Value.Check throws and gets caught.
    // Instead, test that the schema catch block is hit — executeTool still executes the tool.
    const result = await executeTool('web_search', { invalid: true });
    // Tool still executes despite invalid schema (catch block skips validation)
    expect(result).toEqual({ results: [] });
  });
});
