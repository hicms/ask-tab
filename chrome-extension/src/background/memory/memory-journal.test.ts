import { runSessionJournal } from './memory-journal';
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

vi.mock('../agents/stream-bridge', () => ({
  completeText: vi
    .fn()
    .mockResolvedValue('Curated: - User prefers dark mode')
    .mockResolvedValueOnce('New memory: user prefers dark mode'),
}));

vi.mock('../tools/memory-tools', () => ({
  executeMemorySearch: vi.fn(async () => 'No matching memory found.'),
}));

vi.mock('../tools/workspace', () => ({
  executeWrite: vi.fn(async () => 'Written'),
}));

vi.mock('./serialize-transcript', () => ({
  serializeTranscript: vi.fn(() => 'User: hello\nAssistant: hi there'),
}));

vi.mock('./transcript-indexing', () => ({
  indexSessionTranscript: vi.fn(async () => ({ chunksCreated: 0 })),
}));

vi.mock('@extension/storage', () => ({
  serverModelsStorage: {
    get: vi.fn(async () => [
      {
        id: 'm1',
        modelId: 'gpt-4o',
        name: 'GPT-4o',
        provider: 'custom',
      },
    ]),
  },
  selectedModelStorage: { get: vi.fn(async () => 'm1') },
  getChat: vi.fn(async () => ({ id: 'chat-1', title: 'Test Chat' })),
  getMessagesByChatId: vi.fn(async () => [
    { role: 'user', parts: [{ type: 'text', text: 'hello' }], createdAt: 1 },
    { role: 'assistant', parts: [{ type: 'text', text: 'hi' }], createdAt: 2 },
    { role: 'user', parts: [{ type: 'text', text: 'bye' }], createdAt: 3 },
    { role: 'assistant', parts: [{ type: 'text', text: 'goodbye' }], createdAt: 4 },
  ]),
  listWorkspaceFiles: vi.fn(async () => [
    {
      id: 'wf-memory',
      name: 'MEMORY.md',
      content: '- User prefers dark mode',
      enabled: true,
      owner: 'user' as const,
      predefined: true,
      createdAt: 1,
      updatedAt: 2,
    },
  ]),
}));

// Import mocked modules for per-test overrides
const { completeText } = await import('../agents/stream-bridge');
const { executeWrite } = await import('../tools/workspace');
const { executeMemorySearch } = await import('../tools/memory-tools');
const { serverModelsStorage, getMessagesByChatId, getChat, listWorkspaceFiles } = await import(
  '@extension/storage'
);
const { serializeTranscript } = await import('./serialize-transcript');

// ── Tests ──────────────────────────────────────

describe('runSessionJournal', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns "written" when LLM produces journal text', async () => {
    const result = await runSessionJournal({
      chatId: 'chat-written',
    });
    expect(result).toBe('written');
    // Daily journal + MEMORY.md curation
    expect(executeWrite).toHaveBeenCalledTimes(2);
  });

  it('returns "no-op" when LLM returns NO_REPLY', async () => {
    vi.mocked(completeText).mockResolvedValueOnce('NO_REPLY');

    const result = await runSessionJournal({
      chatId: 'chat-noop',
    });
    expect(result).toBe('no-op');
    expect(executeWrite).not.toHaveBeenCalled();
  });

  it('returns "skipped" when no model configured', async () => {
    vi.mocked(serverModelsStorage.get).mockResolvedValueOnce([]);

    const result = await runSessionJournal({
      chatId: 'chat-nomodel',
    });
    expect(result).toBe('skipped');
    expect(completeText).not.toHaveBeenCalled();
  });

  it('returns "skipped" when too few messages (< 4)', async () => {
    vi.mocked(getMessagesByChatId).mockResolvedValueOnce([
      { role: 'user', parts: [{ type: 'text', text: 'hi' }], createdAt: 1 },
      { role: 'assistant', parts: [{ type: 'text', text: 'hello' }], createdAt: 2 },
    ] as unknown as Awaited<ReturnType<typeof getMessagesByChatId>>);

    const result = await runSessionJournal({
      chatId: 'chat-fewmsgs',
    });
    expect(result).toBe('skipped');
    expect(completeText).not.toHaveBeenCalled();
  });

  it('returns "skipped" on dedup cooldown (call twice rapidly with same chatId)', async () => {
    const chatId = 'chat-dedup-test';

    const first = await runSessionJournal({ chatId });
    expect(first).toBe('written');

    const second = await runSessionJournal({ chatId });
    expect(second).toBe('skipped');
  });

  it('uses provided modelConfig instead of resolving from storage', async () => {
    const customModel: ChatModel = {
      id: 'custom-model',
      name: 'Custom Model',
      provider: 'anthropic',
    };

    const result = await runSessionJournal({
      chatId: 'chat-custom-model',
      modelConfig: customModel,
    });
    expect(result).toBe('written');
    // completeText should have been called with the custom model
    expect(completeText).toHaveBeenCalledWith(
      customModel,
      expect.any(String),
      expect.any(String),
      expect.objectContaining({ maxTokens: 500 }),
    );
    // Storage model resolution should NOT have been called
    expect(serverModelsStorage.get).not.toHaveBeenCalled();
  });

  it('uses provided transcript instead of loading from DB', async () => {
    const transcript = 'Pre-built transcript: User asked about weather.';

    const result = await runSessionJournal({
      chatId: 'chat-transcript',
      transcript,
    });
    expect(result).toBe('written');
    // getMessagesByChatId should NOT have been called
    expect(getMessagesByChatId).not.toHaveBeenCalled();
    // completeText user message should contain the provided transcript
    expect(completeText).toHaveBeenCalledWith(
      expect.any(Object),
      expect.any(String),
      expect.stringContaining(transcript),
      expect.any(Object),
    );
  });

  it('calls executeWrite with memory/YYYY-MM-DD.md path', async () => {
    const date = new Date().toISOString().split('T')[0];

    await runSessionJournal({
      chatId: 'chat-path-check',
    });

    expect(executeWrite).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({
        path: `memory/${date}.md`,
        mode: 'append',
      }),
      undefined,
    );
  });

  // ── Retry / error handling ──

  it('retries on transient error (statusCode=500) and succeeds', async () => {
    const error500 = new Error('Internal Server Error');
    (error500 as unknown as Record<string, unknown>).statusCode = 500;

    vi.mocked(completeText)
      .mockRejectedValueOnce(error500)
      .mockResolvedValueOnce('Retried memory: user likes TypeScript')
      .mockResolvedValueOnce('- User likes TypeScript');

    const result = await runSessionJournal({
      chatId: 'chat-retry-500',
    });
    expect(result).toBe('written');
    expect(completeText).toHaveBeenCalledTimes(3);
    expect(executeWrite).toHaveBeenCalled();
  });

  it('retries on "fetch failed" network error and succeeds', async () => {
    vi.mocked(completeText)
      .mockRejectedValueOnce(new Error('fetch failed'))
      .mockResolvedValueOnce('Network recovered memory')
      .mockResolvedValueOnce('- Network recovered curated');

    const result = await runSessionJournal({
      chatId: 'chat-retry-network',
    });
    expect(result).toBe('written');
    expect(completeText).toHaveBeenCalledTimes(3);
  });

  it('retries on "Invalid JSON response" and succeeds', async () => {
    vi.mocked(completeText)
      .mockRejectedValueOnce(new Error('Invalid JSON response'))
      .mockResolvedValueOnce('Fixed JSON memory')
      .mockResolvedValueOnce('- Fixed JSON curated');

    const result = await runSessionJournal({
      chatId: 'chat-retry-json',
    });
    expect(result).toBe('written');
    expect(completeText).toHaveBeenCalledTimes(3);
  });

  it('does not retry on non-transient error (statusCode=400) — returns skipped', async () => {
    const error400 = new Error('Bad Request');
    (error400 as unknown as Record<string, unknown>).statusCode = 400;

    vi.mocked(completeText).mockRejectedValueOnce(error400);

    const result = await runSessionJournal({
      chatId: 'chat-no-retry-400',
    });
    expect(result).toBe('skipped');
    expect(completeText).toHaveBeenCalledTimes(1);
  });

  it('does not retry on "aborted" error — returns skipped', async () => {
    vi.mocked(completeText).mockRejectedValueOnce(new Error('aborted'));

    const result = await runSessionJournal({
      chatId: 'chat-no-retry-abort',
    });
    expect(result).toBe('skipped');
    expect(completeText).toHaveBeenCalledTimes(1);
  });

  // ── Memory search + dedup ──

  it('proceeds without dedup when memory search fails', async () => {
    vi.mocked(executeMemorySearch).mockRejectedValueOnce(new Error('Search unavailable'));

    const result = await runSessionJournal({
      chatId: 'chat-search-fail',
    });
    // Should still succeed despite search failure
    expect(result).toBe('written');
    expect(completeText).toHaveBeenCalled();
  });

  it('includes existing memories as dedup context in LLM prompt', async () => {
    vi.mocked(executeMemorySearch).mockResolvedValueOnce(
      '- User prefers dark mode\n- User uses TypeScript',
    );

    const result = await runSessionJournal({
      chatId: 'chat-dedup-context',
    });
    expect(result).toBe('written');
    // The user message to completeText should include the existing memories
    expect(completeText).toHaveBeenCalledWith(
      expect.any(Object),
      expect.any(String),
      expect.stringContaining('Existing memories (DO NOT duplicate these)'),
      expect.any(Object),
    );
  });

  // ── Edge cases ──

  it('returns no-op when LLM returns empty string', async () => {
    vi.mocked(completeText).mockResolvedValueOnce('');

    const result = await runSessionJournal({
      chatId: 'chat-empty-flush',
    });
    expect(result).toBe('no-op');
    expect(executeWrite).not.toHaveBeenCalled();
  });

  it('returns skipped when empty transcript from serializer', async () => {
    vi.mocked(serializeTranscript).mockReturnValueOnce('');

    const result = await runSessionJournal({
      chatId: 'chat-empty-transcript',
    });
    expect(result).toBe('skipped');
    expect(completeText).not.toHaveBeenCalled();
  });

  it('uses chat title as search query for memory dedup', async () => {
    vi.mocked(getChat).mockResolvedValueOnce({
      id: 'chat-titled',
      title: 'TypeScript Patterns',
    } as Awaited<ReturnType<typeof getChat>>);

    await runSessionJournal({
      chatId: 'chat-titled',
    });

    expect(executeMemorySearch).toHaveBeenCalledWith(
      expect.objectContaining({ query: 'TypeScript Patterns' }),
    );
  });

  // ── MEMORY.md curation ──

  describe('MEMORY.md curation', () => {
    it('curates MEMORY.md after writing daily journal entry', async () => {
      vi.mocked(completeText)
        .mockResolvedValueOnce('New fact: user likes TypeScript')
        .mockResolvedValueOnce('- User prefers dark mode\n- User likes TypeScript');

      const result = await runSessionJournal({ chatId: 'chat-curate' });

      expect(result).toBe('written');
      expect(completeText).toHaveBeenCalledTimes(2);
      expect(executeWrite).toHaveBeenCalledTimes(2);

      // First write: daily journal (append)
      const date = new Date().toISOString().split('T')[0];
      expect(executeWrite).toHaveBeenNthCalledWith(
        1,
        expect.objectContaining({ path: `memory/${date}.md`, mode: 'append' }),
        undefined,
      );

      // Second write: MEMORY.md (overwrite)
      expect(executeWrite).toHaveBeenNthCalledWith(
        2,
        expect.objectContaining({ path: 'MEMORY.md', mode: 'overwrite' }),
        undefined,
      );

      // Curation prompt should include existing MEMORY.md content
      expect(completeText).toHaveBeenNthCalledWith(
        2,
        expect.any(Object),
        expect.any(String),
        expect.stringContaining('User prefers dark mode'),
        expect.any(Object),
      );
    });

    it('skips MEMORY.md write when curated content is unchanged', async () => {
      vi.mocked(completeText)
        .mockResolvedValueOnce('New memory: user prefers dark mode')
        .mockResolvedValueOnce('- User prefers dark mode');

      await runSessionJournal({ chatId: 'chat-unchanged' });

      // Only the daily journal write, no MEMORY.md overwrite
      expect(executeWrite).toHaveBeenCalledTimes(1);
    });

    it('curates MEMORY.md from empty state', async () => {
      vi.mocked(listWorkspaceFiles).mockResolvedValueOnce([
        {
          id: 'wf-memory',
          name: 'MEMORY.md',
          content: '',
          enabled: true,
          owner: 'user' as const,
          predefined: true,
          createdAt: 1,
          updatedAt: 2,
        },
      ]);
      vi.mocked(completeText)
        .mockResolvedValueOnce('User introduced themselves as Kyle')
        .mockResolvedValueOnce('- User name: Kyle');

      await runSessionJournal({ chatId: 'chat-empty-memory' });

      expect(executeWrite).toHaveBeenCalledTimes(2);
      // Curation prompt should indicate MEMORY.md is empty
      expect(completeText).toHaveBeenNthCalledWith(
        2,
        expect.any(Object),
        expect.any(String),
        expect.stringContaining('(empty)'),
        expect.any(Object),
      );
    });

    it('still returns "written" when MEMORY.md curation LLM call fails', async () => {
      vi.mocked(completeText)
        .mockResolvedValueOnce('New memory worth saving')
        .mockRejectedValueOnce(new Error('LLM curation timeout'));

      const result = await runSessionJournal({ chatId: 'chat-curate-fail' });

      expect(result).toBe('written');
      expect(executeWrite).toHaveBeenCalledTimes(1);
    });

    it('still returns "written" when listWorkspaceFiles fails during curation', async () => {
      vi.mocked(listWorkspaceFiles).mockRejectedValueOnce(new Error('DB error'));
      vi.mocked(completeText).mockResolvedValueOnce('Some journal entry');

      const result = await runSessionJournal({ chatId: 'chat-list-fail' });

      expect(result).toBe('written');
      expect(executeWrite).toHaveBeenCalledTimes(1);
      expect(completeText).toHaveBeenCalledTimes(1);
    });

    it('does not attempt curation when journal returns NO_REPLY', async () => {
      vi.mocked(completeText).mockResolvedValueOnce('NO_REPLY');

      const result = await runSessionJournal({ chatId: 'chat-no-curate' });

      expect(result).toBe('no-op');
      expect(completeText).toHaveBeenCalledTimes(1);
      expect(executeWrite).not.toHaveBeenCalled();
      expect(listWorkspaceFiles).not.toHaveBeenCalled();
    });

    it('passes agentId to listWorkspaceFiles and executeWrite for MEMORY.md', async () => {
      vi.mocked(completeText)
        .mockResolvedValueOnce('Agent-scoped memory')
        .mockResolvedValueOnce('- Agent-scoped curated');

      await runSessionJournal({ chatId: 'chat-agent-scope', agentId: 'agent-42' });

      expect(listWorkspaceFiles).toHaveBeenCalledWith('agent-42');
      expect(executeWrite).toHaveBeenNthCalledWith(
        2,
        expect.objectContaining({ path: 'MEMORY.md', mode: 'overwrite' }),
        'agent-42',
      );
    });

    it('curation prompt includes conciseness instruction', async () => {
      vi.mocked(completeText)
        .mockResolvedValueOnce('Some journal text')
        .mockResolvedValueOnce('- Curated content');

      await runSessionJournal({ chatId: 'chat-concise' });

      // The system prompt (second arg) of the curation call should mention size limit
      expect(completeText).toHaveBeenNthCalledWith(
        2,
        expect.any(Object),
        expect.stringContaining('4000 characters'),
        expect.any(String),
        expect.any(Object),
      );
    });
  });
});
