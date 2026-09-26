import {
  makeAgentUserMessage,
  makeAgentAssistantMessage,
  defaultOpts,
} from '../../../../tests/unit/context-transform-setup';
import { describe, it, expect, vi, beforeEach } from 'vitest';

const { compactMessagesWithSummary } = await import('./compaction');
const { createTransformContext } = await import('./transform');
const { updateCompactionMetadata, getAgent } = await import('@extension/storage');

describe('createTransformContext — thinkingSignature preservation', () => {
  const mockCompact = vi.mocked(compactMessagesWithSummary);

  beforeEach(() => {
    vi.clearAllMocks();
    mockCompact.mockResolvedValue({
      messages: [],
      wasCompacted: false,
      compactionMethod: 'none',
      summary: undefined,
    });
  });

  it('preserves thinkingSignature when converting thinking to reasoning part', async () => {
    const messages = [
      {
        role: 'assistant' as const,
        content: [
          {
            type: 'thinking' as const,
            thinking: 'Let me think...',
            thinkingSignature: '{"id":"rs_123","type":"reasoning"}',
          },
        ],
        api: 'openai-completions' as const,
        provider: 'openai' as const,
        model: 'gpt-5.3-codex',
        usage: {
          input: 10,
          output: 5,
          cacheRead: 0,
          cacheWrite: 0,
          totalTokens: 15,
          cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
        },
        stopReason: 'stop' as const,
        timestamp: Date.now(),
      },
    ];

    mockCompact.mockResolvedValueOnce({
      messages: [
        {
          id: 'msg-1',
          chatId: 'chat-1',
          role: 'assistant',
          parts: [
            {
              type: 'reasoning',
              text: 'Let me think...',
              signature: '{"id":"rs_123","type":"reasoning"}',
            },
          ],
          createdAt: Date.now(),
        },
      ],
      wasCompacted: false,
      compactionMethod: 'none',
      summary: undefined,
    });

    const { transformContext } = createTransformContext(defaultOpts);
    await transformContext(messages);

    const chatMessages = mockCompact.mock.calls[0][0];
    expect(chatMessages[0].parts[0]).toEqual({
      type: 'reasoning',
      text: 'Let me think...',
      signature: '{"id":"rs_123","type":"reasoning"}',
    });
  });

  it('omits signature field when thinking has no thinkingSignature', async () => {
    const messages = [
      {
        role: 'assistant' as const,
        content: [{ type: 'thinking' as const, thinking: 'Let me think...' }],
        api: 'openai-completions' as const,
        provider: 'openai' as const,
        model: 'gpt-4o',
        usage: {
          input: 10,
          output: 5,
          cacheRead: 0,
          cacheWrite: 0,
          totalTokens: 15,
          cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
        },
        stopReason: 'stop' as const,
        timestamp: Date.now(),
      },
    ];

    mockCompact.mockResolvedValueOnce({
      messages: [
        {
          id: 'msg-1',
          chatId: 'chat-1',
          role: 'assistant',
          parts: [{ type: 'reasoning', text: 'Let me think...' }],
          createdAt: Date.now(),
        },
      ],
      wasCompacted: false,
      compactionMethod: 'none',
      summary: undefined,
    });

    const { transformContext } = createTransformContext(defaultOpts);
    await transformContext(messages);

    const chatMessages = mockCompact.mock.calls[0][0];
    const part = chatMessages[0].parts[0] as { type: string; text: string; signature?: string };
    expect(part.type).toBe('reasoning');
    expect(part.text).toBe('Let me think...');
    expect(part.signature).toBeUndefined();
  });

  it('preserves signature through full round-trip: thinking → reasoning → thinking', async () => {
    // This test verifies the complete pipeline:
    // 1. Agent message with thinking + thinkingSignature
    // 2. Convert to ChatMessage (transform.ts) → reasoning + signature
    // 3. Convert back to pi-mono (message-adapter.ts via chatMessagesToPiMessages mock)

    const sig = '{"id":"rs_456","type":"reasoning"}';
    const messages = [
      {
        role: 'assistant' as const,
        content: [
          { type: 'thinking' as const, thinking: 'Deep thought', thinkingSignature: sig },
          { type: 'text' as const, text: 'The answer is 42' },
        ],
        api: 'openai-completions' as const,
        provider: 'openai' as const,
        model: 'gpt-5.3-codex',
        usage: {
          input: 10,
          output: 5,
          cacheRead: 0,
          cacheWrite: 0,
          totalTokens: 15,
          cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
        },
        stopReason: 'stop' as const,
        timestamp: Date.now(),
      },
    ];

    mockCompact.mockResolvedValueOnce({
      messages: [
        {
          id: 'msg-1',
          chatId: 'chat-1',
          role: 'assistant',
          parts: [
            { type: 'reasoning', text: 'Deep thought', signature: sig },
            { type: 'text', text: 'The answer is 42' },
          ],
          createdAt: Date.now(),
        },
      ],
      wasCompacted: false,
      compactionMethod: 'none',
      summary: undefined,
    });

    const { transformContext } = createTransformContext(defaultOpts);
    await transformContext(messages);

    // Step 2: Verify transform.ts produced reasoning with signature
    const chatMessages = mockCompact.mock.calls[0][0];
    const reasoningPart = chatMessages[0].parts[0] as {
      type: string;
      text: string;
      signature?: string;
    };
    expect(reasoningPart.signature).toBe(sig);

    // Step 3: The chatMessagesToPiMessages mock is called with the compacted messages.
    // In real code, message-adapter.ts would convert signature → thinkingSignature.
    // We verify the intermediate ChatMessage format is correct.
    expect(reasoningPart.type).toBe('reasoning');
    expect(reasoningPart.text).toBe('Deep thought');
  });
});

// ── Workspace rules: criticalRules passed to compaction ──

describe('createTransformContext — workspace rules', () => {
  const mockCompact = vi.mocked(compactMessagesWithSummary);

  beforeEach(() => {
    vi.clearAllMocks();
    mockCompact.mockResolvedValue({
      messages: [],
      wasCompacted: false,
      compactionMethod: 'none',
      summary: undefined,
    });
  });

  it('passes criticalRules to compactMessagesWithSummary', async () => {
    const { getEnabledWorkspaceFiles } = await import('@extension/storage');
    const mockGetFiles = vi.mocked(getEnabledWorkspaceFiles);
    mockGetFiles.mockResolvedValueOnce([
      {
        id: 'ws-1',
        name: 'AGENTS.md',
        content: '## Red Lines\nNever do X\n## Other\nEnd',
        enabled: true,
        owner: 'user',
        predefined: true,
        createdAt: 0,
        updatedAt: 0,
        agentId: 'main',
      },
    ] as Awaited<ReturnType<typeof getEnabledWorkspaceFiles>>);

    const { extractCriticalRules } = await import('./summarizer');
    const mockExtract = vi.mocked(extractCriticalRules);
    mockExtract.mockReturnValueOnce('Red Lines\nNever do X');

    mockCompact.mockResolvedValueOnce({
      messages: [
        {
          id: 'msg-1',
          chatId: 'chat-1',
          role: 'user',
          parts: [{ type: 'text', text: 'Hello' }],
          createdAt: Date.now(),
        },
      ],
      wasCompacted: false,
      compactionMethod: 'none',
      summary: undefined,
    });

    const { transformContext } = createTransformContext({ ...defaultOpts, agentId: 'main' });
    await transformContext([makeAgentUserMessage('Hello')]);

    // extractCriticalRules should have been called with the workspace files
    expect(mockExtract).toHaveBeenCalledWith(
      expect.arrayContaining([expect.objectContaining({ name: 'AGENTS.md' })]),
    );

    // The criticalRules returned by extractCriticalRules should be passed to compactMessagesWithSummary
    const options = mockCompact.mock.calls[0]![3];
    expect(options).toBeDefined();
    expect(options!.criticalRules).toBe('Red Lines\nNever do X');
  });
});

// ── Phase 5C: CompactionConfig threading ──

describe('createTransformContext — compaction config', () => {
  const mockCompact = vi.mocked(compactMessagesWithSummary);
  const mockGetAgent = vi.mocked(getAgent);

  beforeEach(() => {
    vi.clearAllMocks();
    mockCompact.mockResolvedValue({
      messages: [],
      wasCompacted: false,
      compactionMethod: 'none',
      summary: undefined,
    });
  });

  it('passes agent compactionConfig to compactMessagesWithSummary', async () => {
    mockGetAgent.mockResolvedValueOnce({
      id: 'agent-1',
      name: 'Test',
      identity: {},
      isDefault: true,
      compactionConfig: { maxHistoryShare: 0.3, qualityGuardEnabled: false },
      createdAt: 0,
      updatedAt: 0,
    } as Awaited<ReturnType<typeof getAgent>>);

    mockCompact.mockResolvedValueOnce({
      messages: [
        {
          id: 'msg-1',
          chatId: 'chat-1',
          role: 'user',
          parts: [{ type: 'text', text: 'Hello' }],
          createdAt: Date.now(),
        },
      ],
      wasCompacted: false,
      compactionMethod: 'none',
      summary: undefined,
    });

    const { transformContext } = createTransformContext({ ...defaultOpts, agentId: 'agent-1' });
    await transformContext([makeAgentUserMessage('Hello')]);

    const options = mockCompact.mock.calls[0]![3];
    expect(options).toBeDefined();
    expect(options!.compactionConfig).toEqual(
      expect.objectContaining({ maxHistoryShare: 0.3, qualityGuardEnabled: false }),
    );
  });

  it('passes undefined compactionConfig when agent has no config', async () => {
    mockGetAgent.mockResolvedValueOnce({
      id: 'agent-1',
      name: 'Test',
      identity: {},
      isDefault: true,
      createdAt: 0,
      updatedAt: 0,
    } as Awaited<ReturnType<typeof getAgent>>);

    mockCompact.mockResolvedValueOnce({
      messages: [
        {
          id: 'msg-1',
          chatId: 'chat-1',
          role: 'user',
          parts: [{ type: 'text', text: 'Hello' }],
          createdAt: Date.now(),
        },
      ],
      wasCompacted: false,
      compactionMethod: 'none',
      summary: undefined,
    });

    const { transformContext } = createTransformContext({ ...defaultOpts, agentId: 'agent-1' });
    await transformContext([makeAgentUserMessage('Hello')]);

    const options = mockCompact.mock.calls[0]![3];
    expect(options!.compactionConfig).toBeUndefined();
  });
});

// ── Phase 6: Compaction metadata persistence ──

describe('createTransformContext — compaction metadata', () => {
  const mockCompact = vi.mocked(compactMessagesWithSummary);
  const mockUpdateMetadata = vi.mocked(updateCompactionMetadata);

  beforeEach(() => {
    vi.clearAllMocks();
    mockCompact.mockResolvedValue({
      messages: [],
      wasCompacted: false,
      compactionMethod: 'none',
      summary: undefined,
    });
  });

  it('updates chat record with compaction metadata when compaction occurs', async () => {
    mockCompact.mockResolvedValueOnce({
      messages: [
        {
          id: 'msg-1',
          chatId: 'chat-1',
          role: 'user',
          parts: [{ type: 'text', text: 'Hello' }],
          createdAt: Date.now(),
        },
      ],
      wasCompacted: true,
      compactionMethod: 'summary',
      summary: 'A summary',
    });

    const { transformContext } = createTransformContext(defaultOpts);
    await transformContext([makeAgentUserMessage('Hello'), makeAgentAssistantMessage('Response')]);

    await vi.waitFor(() => {
      expect(mockUpdateMetadata).toHaveBeenCalledWith(
        'chat-1',
        expect.objectContaining({
          compactionMethod: 'summary',
          compactionTokensBefore: expect.any(Number),
          compactionTokensAfter: expect.any(Number),
        }),
      );
    });
  });

  it('does not update metadata when no compaction occurred', async () => {
    mockCompact.mockResolvedValueOnce({
      messages: [
        {
          id: 'msg-1',
          chatId: 'chat-1',
          role: 'user',
          parts: [{ type: 'text', text: 'Hello' }],
          createdAt: Date.now(),
        },
      ],
      wasCompacted: false,
      compactionMethod: 'none',
      summary: undefined,
    });

    const { transformContext } = createTransformContext(defaultOpts);
    await transformContext([makeAgentUserMessage('Hello')]);

    expect(mockUpdateMetadata).not.toHaveBeenCalled();
  });
});
