import { executeScheduledTask } from './executor';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { ScheduledTask } from './types';

// ── Mocks ──────────────────────────────────────

vi.mock('../channels/registry', () => ({
  getChannelAdapter: vi.fn(async () => null),
}));

vi.mock('../channels/config', () => ({
  getChannelConfigs: vi.fn(async () => []),
}));

vi.mock('../agents/agent-setup', () => ({
  runHeadlessLLM: vi.fn(async () => ({
    status: 'ok',
    chatId: 'chat-1',
    responseText: 'Done',
  })),
  resolveDefaultModel: vi.fn(async () => ({
    id: 'gpt-4o',
    name: 'GPT-4o',
    provider: 'openai',
  })),
  dbModelToChatModel: vi.fn(m => m),
}));

vi.mock('../logging/logger-buffer', () => ({
  createLogger: () => ({
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    trace: vi.fn(),
  }),
}));

vi.mock('@extension/storage', () => ({
  addMessage: vi.fn(async () => {}),
  getChat: vi.fn(async (id: string) => (id === 'chat-1' ? { id: 'chat-1', title: 'Test' } : null)),
  getMostRecentChat: vi.fn(async () => ({ id: 'recent-chat', title: 'Recent' })),
  touchChat: vi.fn(async () => {}),
  serverModelsStorage: { get: vi.fn(async () => []) },
  lastActiveSessionStorage: { get: vi.fn(async () => null) },
}));

vi.mock('nanoid', () => ({ nanoid: () => 'test-id' }));

vi.stubGlobal('chrome', {
  runtime: { sendMessage: vi.fn(async () => ({})) },
  alarms: {
    create: vi.fn(),
    clear: vi.fn(),
  },
});

// Import mocked modules for per-test overrides
const { resolveDefaultModel, runHeadlessLLM } = await import('../agents/agent-setup');
const { getChannelAdapter } = await import('../channels/registry');
const { getChannelConfigs } = await import('../channels/config');
const { addMessage, getChat, getMostRecentChat, touchChat, lastActiveSessionStorage } =
  await import('@extension/storage');

// ── Helpers ────────────────────────────────────

const createTask = (overrides: Partial<ScheduledTask> = {}): ScheduledTask => ({
  id: 'task-1',
  name: 'Test Task',
  enabled: true,
  createdAt: Date.now(),
  updatedAt: Date.now(),
  schedule: { kind: 'every', everyMs: 60000 },
  payload: { kind: 'agentTurn', message: 'Run task' },
  state: {},
  ...overrides,
});

// ── Tests ──────────────────────────────────────

describe('executeScheduledTask', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // Restore default mock implementations after clearAllMocks
    vi.mocked(resolveDefaultModel).mockResolvedValue({
      id: 'gpt-4o',
      name: 'GPT-4o',
      provider: 'openai',
    } as Awaited<ReturnType<typeof resolveDefaultModel>>);
    vi.mocked(getChat).mockImplementation(async (id: string) =>
      id === 'chat-1'
        ? ({ id: 'chat-1', title: 'Test' } as Awaited<ReturnType<typeof getChat>>)
        : undefined,
    );
    vi.mocked(getMostRecentChat).mockResolvedValue({
      id: 'recent-chat',
      title: 'Recent',
    } as Awaited<ReturnType<typeof getMostRecentChat>>);
  });

  it('executes agentTurn and returns ok result', async () => {
    const task = createTask();
    const result = await executeScheduledTask(task);
    expect(result.status).toBe('ok');
    expect(result.chatId).toBe('chat-1');
  });

  it('returns error when no model configured', async () => {
    vi.mocked(resolveDefaultModel).mockResolvedValueOnce(
      undefined as unknown as Awaited<ReturnType<typeof resolveDefaultModel>>,
    );

    const task = createTask();
    const result = await executeScheduledTask(task);
    expect(result.status).toBe('error');
    expect(result.error).toContain('No model configured');
  });

  it('executes chatInject and saves message to chat', async () => {
    const task = createTask({
      payload: { kind: 'chatInject', chatId: 'chat-1', message: 'Injected message' },
    });

    const result = await executeScheduledTask(task);
    expect(result.status).toBe('ok');
    expect(result.chatId).toBe('chat-1');
    expect(addMessage).toHaveBeenCalledWith(
      expect.objectContaining({
        chatId: 'chat-1',
        role: 'user',
        parts: [{ type: 'text', text: '[Scheduled: Test Task] Injected message' }],
      }),
    );
    expect(touchChat).toHaveBeenCalledWith('chat-1');
  });

  it('chatInject falls back to most recent chat when target not found', async () => {
    const task = createTask({
      payload: { kind: 'chatInject', chatId: 'nonexistent', message: 'Fallback test' },
    });

    const result = await executeScheduledTask(task);
    expect(result.status).toBe('ok');
    expect(result.chatId).toBe('recent-chat');
    expect(addMessage).toHaveBeenCalledWith(expect.objectContaining({ chatId: 'recent-chat' }));
  });

  it('chatInject returns error when no available chat', async () => {
    vi.mocked(getChat).mockResolvedValue(undefined);
    vi.mocked(getMostRecentChat).mockResolvedValue(undefined);

    const task = createTask({
      payload: { kind: 'chatInject', chatId: 'nonexistent', message: 'No chat' },
    });

    const result = await executeScheduledTask(task);
    expect(result.status).toBe('error');
    expect(result.error).toContain('No available chat');
  });

  it('returns error for unknown payload kind', async () => {
    const task = createTask({
      payload: { kind: 'unknownKind' as 'agentTurn', message: 'bad' },
    });

    const result = await executeScheduledTask(task);
    expect(result.status).toBe('error');
    expect(result.error).toContain('Unknown payload kind');
  });

  it('handles timeout via AbortController', async () => {
    vi.mocked(runHeadlessLLM).mockImplementationOnce(
      async ({ signal }: { signal?: AbortSignal }) =>
        new Promise((_resolve, reject) => {
          if (signal?.aborted) {
            reject(new Error('aborted'));
            return;
          }
          signal?.addEventListener('abort', () => {
            reject(new Error('aborted'));
          });
        }),
    );

    const task = createTask({ timeoutMs: 50 });
    await expect(executeScheduledTask(task)).rejects.toThrow('aborted');
  });

  it('chatInject returns error when chatId is missing', async () => {
    const task = createTask({
      payload: { kind: 'chatInject', chatId: '', message: 'No chat ID' },
    });

    const result = await executeScheduledTask(task);
    expect(result.status).toBe('error');
    expect(result.error).toContain('chatInject payload missing chatId');
  });

  it('chatInject falls back to lastActiveSession when target not found', async () => {
    vi.mocked(getChat).mockImplementation(async (id: string) =>
      id === 'active-chat'
        ? ({ id: 'active-chat', title: 'Active' } as Awaited<ReturnType<typeof getChat>>)
        : undefined,
    );
    vi.mocked(lastActiveSessionStorage.get).mockResolvedValue('active-chat');

    const task = createTask({
      payload: { kind: 'chatInject', chatId: 'nonexistent', message: 'Fallback to active' },
    });

    const result = await executeScheduledTask(task);
    expect(result.status).toBe('ok');
    expect(result.chatId).toBe('active-chat');
  });

  it('delivers agentTurn result to channel when delivery is configured', async () => {
    const mockAdapter = {
      id: 'telegram',
      maxMessageLength: 4096,
      sendMessage: vi.fn(async () => ({ ok: true, messageId: 42 })),
    };
    vi.mocked(getChannelAdapter).mockResolvedValue(mockAdapter as never);

    const task = createTask({
      delivery: { channel: 'telegram', to: '123', bestEffort: true },
    });

    const result = await executeScheduledTask(task);
    expect(result.status).toBe('ok');
    expect(mockAdapter.sendMessage).toHaveBeenCalledWith(
      expect.objectContaining({ to: '123', text: 'Done' }),
    );
  });

  it('delivery with bestEffort=true warns when no adapter', async () => {
    vi.mocked(getChannelAdapter).mockResolvedValue(null as never);

    const task = createTask({
      delivery: { channel: 'unknown', to: '123', bestEffort: true },
    });

    // Should complete without error (bestEffort)
    const result = await executeScheduledTask(task);
    expect(result.status).toBe('ok');
  });

  it('delivery with bestEffort=false returns error when no adapter', async () => {
    vi.mocked(getChannelAdapter).mockResolvedValue(null as never);

    const task = createTask({
      delivery: { channel: 'unknown', to: '123', bestEffort: false },
    });

    const result = await executeScheduledTask(task);
    expect(result.status).toBe('error');
    expect(result.error).toContain('delivery failed');
  });

  it('resolves default delivery from active channel when no explicit delivery', async () => {
    vi.mocked(getChannelConfigs).mockResolvedValue([
      {
        channelId: 'telegram',
        enabled: true,
        status: 'passive',
        allowedSenderIds: ['456'],
        credentials: { botToken: 'tok' },
      },
    ] as never);
    const mockAdapter = {
      id: 'telegram',
      maxMessageLength: 4096,
      sendMessage: vi.fn(async () => ({ ok: true, messageId: 1 })),
    };
    vi.mocked(getChannelAdapter).mockResolvedValue(mockAdapter as never);

    const task = createTask(); // no delivery field

    const result = await executeScheduledTask(task);
    expect(result.status).toBe('ok');
    expect(mockAdapter.sendMessage).toHaveBeenCalled();
  });

  it('agentTurn returns error when headless LLM returns error', async () => {
    vi.mocked(runHeadlessLLM).mockResolvedValueOnce({
      status: 'error',
      chatId: 'chat-err',
      responseText: '',
      error: 'Model rate limited',
    });

    const task = createTask();
    const result = await executeScheduledTask(task);
    expect(result.status).toBe('error');
    expect(result.error).toBe('Model rate limited');
  });

  it('agentTurn uses override model when payload.model matches a stored model', async () => {
    const { serverModelsStorage, lastActiveSessionStorage: _las } = await import(
      '@extension/storage'
    );
    vi.mocked(serverModelsStorage.get).mockResolvedValueOnce([
      { id: 'm1', modelId: 'special-model', name: 'Special', provider: 'openai' },
    ] as never);

    const task = createTask({
      payload: { kind: 'agentTurn', message: 'Run with special model', model: 'special-model' },
    });

    const result = await executeScheduledTask(task);
    expect(result.status).toBe('ok');
  });

  it('chatInject handles addMessage error gracefully', async () => {
    vi.mocked(addMessage).mockRejectedValueOnce(new Error('DB write failed'));

    const task = createTask({
      payload: { kind: 'chatInject', chatId: 'chat-1', message: 'Inject fail' },
    });

    const result = await executeScheduledTask(task);
    expect(result.status).toBe('error');
    expect(result.error).toContain('Failed to inject');
  });
});
