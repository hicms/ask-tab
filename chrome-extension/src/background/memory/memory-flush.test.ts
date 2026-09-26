import { runMemoryFlushIfNeeded, resolveMemoryFlushPromptForRun } from './memory-flush';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { ChatModel } from '@extension/shared';

// ── Mocks ──────────────────────────────────────

vi.mock('../logging/logger-buffer', () => ({
  createLogger: () => ({
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    trace: vi.fn(),
  }),
}));

vi.mock('../agents/agent-setup', () => ({
  runAgent: vi.fn(async () => ({
    responseText: 'NO_REPLY',
    parts: [],
    usage: { inputTokens: 100, outputTokens: 50 },
    agent: {},
    stepCount: 1,
    timedOut: false,
    retryAttempts: 0,
  })),
}));

vi.mock('../context/compaction', () => ({
  estimateMessageTokens: vi.fn(() => 500),
  shouldRunMemoryFlush: vi.fn(() => true),
}));

vi.mock('@extension/storage', () => ({
  getChat: vi.fn(async () => ({
    id: 'chat-1',
    title: 'Test Chat',
    compactionCount: 2,
    memoryFlushCompactionCount: 1,
  })),
  getMessagesByChatId: vi.fn(async () => [
    { role: 'user', parts: [{ type: 'text', text: 'hello' }], createdAt: 1 },
    { role: 'assistant', parts: [{ type: 'text', text: 'hi' }], createdAt: 2 },
    { role: 'user', parts: [{ type: 'text', text: 'bye' }], createdAt: 3 },
    { role: 'assistant', parts: [{ type: 'text', text: 'goodbye' }], createdAt: 4 },
  ]),
  updateMemoryFlush: vi.fn(async () => {}),
}));

// Import mocked modules for per-test overrides
const { runAgent } = await import('../agents/agent-setup');
const { shouldRunMemoryFlush } = await import('../context/compaction');
const { getChat, getMessagesByChatId, updateMemoryFlush } = await import('@extension/storage');

const testModel: ChatModel = {
  id: 'gpt-4o',
  name: 'GPT-4o',
  provider: 'custom',
  supportsTools: true,
};

// ── Tests ──────────────────────────────────────

describe('resolveMemoryFlushPromptForRun', () => {
  it('replaces YYYY-MM-DD with current date', () => {
    const today = new Date().toISOString().split('T')[0];
    const result = resolveMemoryFlushPromptForRun('Save to memory/YYYY-MM-DD.md');
    expect(result).toBe(`Save to memory/${today}.md`);
  });

  it('replaces multiple occurrences', () => {
    const today = new Date().toISOString().split('T')[0];
    const result = resolveMemoryFlushPromptForRun('YYYY-MM-DD and YYYY-MM-DD');
    expect(result).toBe(`${today} and ${today}`);
  });

  it('returns unchanged string with no placeholder', () => {
    const result = resolveMemoryFlushPromptForRun('No date here');
    expect(result).toBe('No date here');
  });
});

describe('runMemoryFlushIfNeeded', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('calls runAgent when shouldRunMemoryFlush returns true', async () => {
    await runMemoryFlushIfNeeded({
      chatId: 'chat-flush',
      modelConfig: testModel,
      systemPrompt: 'You are helpful.',
      systemPromptTokens: 100,
    });

    expect(runAgent).toHaveBeenCalledTimes(1);
    expect(runAgent).toHaveBeenCalledWith(
      expect.objectContaining({
        model: testModel,
        headlessTools: true,
      }),
    );
    expect(updateMemoryFlush).toHaveBeenCalled();
  });

  it('skips when shouldRunMemoryFlush returns false', async () => {
    vi.mocked(shouldRunMemoryFlush).mockReturnValueOnce(false);

    await runMemoryFlushIfNeeded({
      chatId: 'chat-no-flush',
      modelConfig: testModel,
      systemPrompt: 'You are helpful.',
      systemPromptTokens: 100,
    });

    expect(runAgent).not.toHaveBeenCalled();
    expect(updateMemoryFlush).not.toHaveBeenCalled();
  });

  it('skips message loading when already flushed for current compaction cycle', async () => {
    vi.mocked(getChat).mockResolvedValueOnce({
      id: 'chat-cycle',
      title: 'Test',
      compactionCount: 3,
      memoryFlushCompactionCount: 3, // same as compactionCount → already flushed
    } as Awaited<ReturnType<typeof getChat>>);

    await runMemoryFlushIfNeeded({
      chatId: 'chat-cycle',
      modelConfig: testModel,
      systemPrompt: '',
      systemPromptTokens: 0,
    });

    // Should exit before loading messages
    expect(getMessagesByChatId).not.toHaveBeenCalled();
    expect(runAgent).not.toHaveBeenCalled();
  });

  it('skips when fewer than 4 messages', async () => {
    vi.mocked(getMessagesByChatId).mockResolvedValueOnce([
      { role: 'user', parts: [{ type: 'text', text: 'hi' }], createdAt: 1 },
      { role: 'assistant', parts: [{ type: 'text', text: 'hello' }], createdAt: 2 },
    ] as unknown as Awaited<ReturnType<typeof getMessagesByChatId>>);

    await runMemoryFlushIfNeeded({
      chatId: 'chat-few-msgs',
      modelConfig: testModel,
      systemPrompt: 'You are helpful.',
      systemPromptTokens: 100,
    });

    expect(runAgent).not.toHaveBeenCalled();
  });

  it('appends flush system prompt to existing system prompt', async () => {
    await runMemoryFlushIfNeeded({
      chatId: 'chat-sysprompt',
      modelConfig: testModel,
      systemPrompt: 'Base system prompt.',
      systemPromptTokens: 100,
    });

    expect(runAgent).toHaveBeenCalledWith(
      expect.objectContaining({
        systemPrompt: expect.stringContaining('Base system prompt.'),
      }),
    );
    expect(runAgent).toHaveBeenCalledWith(
      expect.objectContaining({
        systemPrompt: expect.stringContaining('Pre-compaction memory flush turn.'),
      }),
    );
  });

  it('updates memoryFlushCompactionCount after flush', async () => {
    vi.mocked(getChat)
      .mockResolvedValueOnce({
        id: 'chat-update',
        title: 'Test',
        compactionCount: 3,
        memoryFlushCompactionCount: 2,
      } as Awaited<ReturnType<typeof getChat>>)
      .mockResolvedValueOnce({
        id: 'chat-update',
        title: 'Test',
        compactionCount: 4,
      } as Awaited<ReturnType<typeof getChat>>);

    await runMemoryFlushIfNeeded({
      chatId: 'chat-update',
      modelConfig: testModel,
      systemPrompt: '',
      systemPromptTokens: 0,
    });

    // Should re-read chat and use the updated compactionCount
    expect(updateMemoryFlush).toHaveBeenCalledWith('chat-update', 4);
  });

  it('catches and logs errors without throwing', async () => {
    vi.mocked(runAgent).mockRejectedValueOnce(new Error('LLM error'));

    // Should not throw
    await runMemoryFlushIfNeeded({
      chatId: 'chat-error',
      modelConfig: testModel,
      systemPrompt: '',
      systemPromptTokens: 0,
    });

    expect(updateMemoryFlush).not.toHaveBeenCalled();
  });

  it('includes current date in the flush prompt', async () => {
    const today = new Date().toISOString().split('T')[0];

    await runMemoryFlushIfNeeded({
      chatId: 'chat-date',
      modelConfig: testModel,
      systemPrompt: '',
      systemPromptTokens: 0,
    });

    expect(runAgent).toHaveBeenCalledWith(
      expect.objectContaining({
        prompt: expect.stringContaining(today),
      }),
    );
  });

  it('mentions MEMORY.md in the flush prompt', async () => {
    await runMemoryFlushIfNeeded({
      chatId: 'chat-memory-prompt',
      modelConfig: testModel,
      systemPrompt: '',
      systemPromptTokens: 0,
    });

    expect(runAgent).toHaveBeenCalledWith(
      expect.objectContaining({
        prompt: expect.stringContaining('MEMORY.md'),
      }),
    );
  });
});
