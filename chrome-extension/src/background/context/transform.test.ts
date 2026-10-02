import {
  defaultOpts,
  makeAgentAssistantMessage,
  makeAgentUserMessage,
} from '../../../../tests/unit/context-transform-setup';
import { beforeEach, describe, expect, it, vi } from 'vitest';

// ── Tests ────────────────────────────────────────────────

const { compactMessagesWithSummary } = await import('./compaction');
const { createTransformContext } = await import('./transform');
const { incrementCompactionCount, updateCompactionSummary } = await import('@extension/storage');

describe('createTransformContext', () => {
  const mockCompact = vi.mocked(compactMessagesWithSummary);
  const mockUpdateSummary = vi.mocked(updateCompactionSummary);
  const mockIncrementCount = vi.mocked(incrementCompactionCount);

  beforeEach(() => {
    vi.clearAllMocks();

    // Default: no compaction needed
    mockCompact.mockResolvedValue({
      messages: [],
      wasCompacted: false,
      compactionMethod: 'none',
      summary: undefined,
    });
  });

  it('returns messages unchanged when no compaction needed', async () => {
    const messages = [makeAgentUserMessage('Hello'), makeAgentAssistantMessage('Hi there!')];

    // compactMessagesWithSummary returns the same messages (unchanged)
    mockCompact.mockResolvedValueOnce({
      messages: [
        {
          id: 'msg-1',
          chatId: 'chat-1',
          role: 'user',
          parts: [{ type: 'text', text: 'Hello' }],
          createdAt: Date.now(),
        },
        {
          id: 'msg-2',
          chatId: 'chat-1',
          role: 'assistant',
          parts: [{ type: 'text', text: 'Hi there!' }],
          createdAt: Date.now(),
        },
      ],
      wasCompacted: false,
      compactionMethod: 'none',
      summary: undefined,
    });

    const { transformContext } = createTransformContext(defaultOpts);
    const result = await transformContext(messages);

    expect(result).toBe(messages);
    expect(mockCompact).toHaveBeenCalledOnce();
  });

  it('retains the generated summary when starting a portable context segment', async () => {
    const latestUser = makeAgentUserMessage('Continue', 3);
    mockCompact.mockResolvedValueOnce({
      messages: [
        {
          id: 'summary',
          chatId: 'chat-1',
          role: 'system',
          parts: [{ type: 'text', text: 'Earlier facts' }],
          createdAt: 2,
        },
        {
          id: 'msg-1-3',
          chatId: 'chat-1',
          role: 'user',
          parts: [{ type: 'text', text: 'Continue' }],
          createdAt: 3,
        },
      ],
      wasCompacted: true,
      compactionMethod: 'summary',
      summary: 'Earlier facts',
    });
    const { transformContext } = createTransformContext(defaultOpts);
    const result = await transformContext([makeAgentUserMessage('Earlier', 1), latestUser]);
    expect(result).toHaveLength(2);
    expect(result[0]?.role).toBe('portableHistory');
    expect(JSON.stringify(result[0])).toContain('Earlier facts');
    expect(result[1]).toBe(latestUser);
  });

  it('getResult() returns { wasCompacted: false } when no compaction', async () => {
    const messages = [makeAgentUserMessage('Hello')];

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

    const { transformContext, getResult } = createTransformContext(defaultOpts);
    await transformContext(messages);

    const result = getResult();
    expect(result.wasCompacted).toBe(false);
  });

  it('getResult() returns { wasCompacted: true, compactionMethod: "summary" } after compaction', async () => {
    const messages = [
      makeAgentUserMessage('Hello'),
      makeAgentAssistantMessage('Response'),
      makeAgentUserMessage('Follow-up'),
    ];

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
      summary: 'User greeted the assistant.',
    });

    const { transformContext, getResult } = createTransformContext(defaultOpts);
    await transformContext(messages);

    const result = getResult();
    expect(result.wasCompacted).toBe(true);
    expect(result.compactionMethod).toBe('summary');
  });

  it('calls updateCompactionSummary when summary is returned', async () => {
    const messages = [makeAgentUserMessage('Hello')];

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
      summary: 'Conversation summary text.',
    });

    const { transformContext } = createTransformContext(defaultOpts);
    await transformContext(messages);

    // updateCompactionSummary is fire-and-forget (.catch), so we need to flush
    await vi.waitFor(() => {
      expect(mockUpdateSummary).toHaveBeenCalledWith('chat-1', 'Conversation summary text.');
    });
  });

  it('calls incrementCompactionCount when wasCompacted is true', async () => {
    const messages = [makeAgentUserMessage('Hello')];

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
      compactionMethod: 'sliding-window',
      summary: undefined,
    });

    const { transformContext } = createTransformContext(defaultOpts);
    await transformContext(messages);

    await vi.waitFor(() => {
      expect(mockIncrementCount).toHaveBeenCalledWith('chat-1');
    });
  });

  // ── agentMessagesToChatMessages conversion tests ──
  // These test the message conversion indirectly via transformContext

  it('converts user message with string content to text part', async () => {
    const messages = [makeAgentUserMessage('Hello string')];

    mockCompact.mockResolvedValueOnce({
      messages: [
        {
          id: 'msg-1',
          chatId: 'chat-1',
          role: 'user',
          parts: [{ type: 'text', text: 'Hello string' }],
          createdAt: Date.now(),
        },
      ],
      wasCompacted: false,
      compactionMethod: 'none',
      summary: undefined,
    });

    const { transformContext } = createTransformContext(defaultOpts);
    const result = await transformContext(messages);

    // compactMessagesWithSummary receives the converted ChatMessage[]
    const chatMessages = mockCompact.mock.calls[0][0];
    expect(chatMessages[0].role).toBe('user');
    expect(chatMessages[0].parts).toEqual([{ type: 'text', text: 'Hello string' }]);

    // Verify the return value flows through chatMessagesToPiMessages mock
    expect(result).toHaveLength(1);
    expect(result[0].role).toBe('user');
  });

  it('converts user message with array content (text parts)', async () => {
    const messages = [
      {
        role: 'user' as const,
        content: [
          { type: 'text' as const, text: 'Part 1' },
          { type: 'text' as const, text: 'Part 2' },
        ],
        timestamp: Date.now(),
      },
    ];

    mockCompact.mockResolvedValueOnce({
      messages: [
        {
          id: 'msg-1',
          chatId: 'chat-1',
          role: 'user',
          parts: [
            { type: 'text', text: 'Part 1' },
            { type: 'text', text: 'Part 2' },
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
    expect(chatMessages[0].parts).toHaveLength(2);
    expect(chatMessages[0].parts[0]).toEqual({ type: 'text', text: 'Part 1' });
    expect(chatMessages[0].parts[1]).toEqual({ type: 'text', text: 'Part 2' });
  });

  it('converts user message with image content to file part', async () => {
    const messages = [
      {
        role: 'user' as const,
        content: [
          {
            type: 'image' as const,
            data: 'base64data',
            mimeType: 'image/png',
          },
        ],
        timestamp: Date.now(),
      },
    ];

    mockCompact.mockResolvedValueOnce({
      messages: [
        {
          id: 'msg-1',
          chatId: 'chat-1',
          role: 'user',
          parts: [{ type: 'file', url: 'base64data', filename: 'image', mediaType: 'image/png' }],
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
    expect(chatMessages[0].parts[0]).toEqual(
      expect.objectContaining({
        type: 'file',
        url: 'base64data',
        filename: 'image',
        mediaType: 'image/png',
      }),
    );
  });

  it('converts assistant message with text content', async () => {
    const messages = [makeAgentAssistantMessage('Hello from assistant')];

    mockCompact.mockResolvedValueOnce({
      messages: [
        {
          id: 'msg-1',
          chatId: 'chat-1',
          role: 'assistant',
          parts: [{ type: 'text', text: 'Hello from assistant' }],
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
    expect(chatMessages[0].role).toBe('assistant');
    expect(chatMessages[0].parts[0]).toEqual({ type: 'text', text: 'Hello from assistant' });
  });

  it('converts assistant message with thinking content to reasoning part', async () => {
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
    expect(chatMessages[0].parts[0]).toEqual({ type: 'reasoning', text: 'Let me think...' });
  });

  it('converts assistant message with toolCall content to tool-call part', async () => {
    const messages = [
      {
        role: 'assistant' as const,
        content: [
          {
            type: 'toolCall' as const,
            id: 'tc-1',
            name: 'get_weather',
            arguments: { city: 'SF' },
          },
        ],
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
          parts: [
            {
              type: 'tool-call',
              toolCallId: 'tc-1',
              toolName: 'get_weather',
              args: { city: 'SF' },
              state: 'output-available',
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
    expect(chatMessages[0].parts[0]).toEqual(
      expect.objectContaining({
        type: 'tool-call',
        toolCallId: 'tc-1',
        toolName: 'get_weather',
        args: { city: 'SF' },
        state: 'output-available',
      }),
    );
  });

  it('converts toolResult message — merges into last assistant parts', async () => {
    const ts = Date.now();
    const messages = [
      {
        role: 'assistant' as const,
        content: [
          {
            type: 'toolCall' as const,
            id: 'tc-1',
            name: 'get_weather',
            arguments: { city: 'SF' },
          },
        ],
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
        timestamp: ts,
      },
      {
        role: 'toolResult' as const,
        toolCallId: 'tc-1',
        toolName: 'get_weather',
        content: [{ type: 'text' as const, text: '{"temp": 72}' }],
        isError: false,
        timestamp: ts + 1,
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
              type: 'tool-call',
              toolCallId: 'tc-1',
              toolName: 'get_weather',
              args: { city: 'SF' },
              state: 'output-available',
            },
            {
              type: 'tool-result',
              toolCallId: 'tc-1',
              toolName: 'get_weather',
              result: { temp: 72 },
              state: 'output-available',
            },
          ],
          createdAt: ts,
        },
      ],
      wasCompacted: false,
      compactionMethod: 'none',
      summary: undefined,
    });

    const { transformContext } = createTransformContext(defaultOpts);
    await transformContext(messages);

    const chatMessages = mockCompact.mock.calls[0][0];
    // Tool result should be merged into the assistant message
    const assistantMsg = chatMessages.find((m: { role: string }) => m.role === 'assistant');
    expect(assistantMsg).toBeDefined();
    const toolResult = assistantMsg!.parts.find(
      (p: { type: string }) => p.type === 'tool-result',
    ) as { type: string; result: unknown; state: string } | undefined;
    expect(toolResult).toBeDefined();
    expect(toolResult!.result).toEqual({ temp: 72 });
    expect(toolResult!.state).toBe('output-available');
  });

  it('converts toolResult with non-JSON text as raw string', async () => {
    const ts = Date.now();
    const messages = [
      {
        role: 'assistant' as const,
        content: [
          {
            type: 'toolCall' as const,
            id: 'tc-2',
            name: 'search',
            arguments: { q: 'test' },
          },
        ],
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
        timestamp: ts,
      },
      {
        role: 'toolResult' as const,
        toolCallId: 'tc-2',
        toolName: 'search',
        content: [{ type: 'text' as const, text: 'Not valid JSON' }],
        isError: false,
        timestamp: ts + 1,
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
              type: 'tool-call',
              toolCallId: 'tc-2',
              toolName: 'search',
              args: { q: 'test' },
              state: 'output-available',
            },
            {
              type: 'tool-result',
              toolCallId: 'tc-2',
              toolName: 'search',
              result: 'Not valid JSON',
              state: 'output-available',
            },
          ],
          createdAt: ts,
        },
      ],
      wasCompacted: false,
      compactionMethod: 'none',
      summary: undefined,
    });

    const { transformContext } = createTransformContext(defaultOpts);
    await transformContext(messages);

    const chatMessages = mockCompact.mock.calls[0][0];
    const assistantMsg = chatMessages.find((m: { role: string }) => m.role === 'assistant');
    const toolResult = assistantMsg!.parts.find(
      (p: { type: string }) => p.type === 'tool-result',
    ) as { type: string; result: unknown; state: string } | undefined;
    expect(toolResult!.result).toBe('Not valid JSON');
  });

  it('converts toolResult with isError=true to output-error state', async () => {
    const ts = Date.now();
    const messages = [
      {
        role: 'assistant' as const,
        content: [
          {
            type: 'toolCall' as const,
            id: 'tc-3',
            name: 'failing_tool',
            arguments: {},
          },
        ],
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
        timestamp: ts,
      },
      {
        role: 'toolResult' as const,
        toolCallId: 'tc-3',
        toolName: 'failing_tool',
        content: [{ type: 'text' as const, text: 'Tool failed' }],
        isError: true,
        timestamp: ts + 1,
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
              type: 'tool-call',
              toolCallId: 'tc-3',
              toolName: 'failing_tool',
              args: {},
              state: 'output-available',
            },
            {
              type: 'tool-result',
              toolCallId: 'tc-3',
              toolName: 'failing_tool',
              result: 'Tool failed',
              state: 'output-error',
            },
          ],
          createdAt: ts,
        },
      ],
      wasCompacted: false,
      compactionMethod: 'none',
      summary: undefined,
    });

    const { transformContext } = createTransformContext(defaultOpts);
    await transformContext(messages);

    const chatMessages = mockCompact.mock.calls[0][0];
    const assistantMsg = chatMessages.find((m: { role: string }) => m.role === 'assistant');
    const toolResult = assistantMsg!.parts.find(
      (p: { type: string }) => p.type === 'tool-result',
    ) as { type: string; result: unknown; state: string } | undefined;
    expect(toolResult!.state).toBe('output-error');
  });

  it('converts toolResult with ImageContent to file parts', async () => {
    const ts = Date.now();
    const messages = [
      {
        role: 'assistant' as const,
        content: [
          {
            type: 'toolCall' as const,
            id: 'tc-ss',
            name: 'browser',
            arguments: { action: 'screenshot', tabId: 1 },
          },
        ],
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
        timestamp: ts,
      },
      {
        role: 'toolResult' as const,
        toolCallId: 'tc-ss',
        toolName: 'browser',
        content: [
          { type: 'text' as const, text: 'Screenshot captured (1200×800)' },
          { type: 'image' as const, data: 'base64screenshotdata', mimeType: 'image/jpeg' },
        ],
        isError: false,
        timestamp: ts + 1,
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
              type: 'tool-call',
              toolCallId: 'tc-ss',
              toolName: 'browser',
              args: { action: 'screenshot', tabId: 1 },
              state: 'output-available',
            },
            {
              type: 'tool-result',
              toolCallId: 'tc-ss',
              toolName: 'browser',
              result: 'Screenshot captured (1200×800)',
              state: 'output-available',
            },
            {
              type: 'file',
              url: '',
              filename: 'tool-image-tc-ss-0.jpg',
              mediaType: 'image/jpeg',
              data: 'base64screenshotdata',
            },
          ],
          createdAt: ts,
        },
      ],
      wasCompacted: false,
      compactionMethod: 'none',
      summary: undefined,
    });

    const { transformContext } = createTransformContext(defaultOpts);
    await transformContext(messages);

    const chatMessages = mockCompact.mock.calls[0][0];
    const assistantMsg = chatMessages.find((m: { role: string }) => m.role === 'assistant');

    // Should have tool-call, tool-result, AND file parts
    const fileParts = assistantMsg!.parts.filter(
      (p: { type: string }) => p.type === 'file',
    ) as Array<{ type: string; filename: string; mediaType: string; data: string }>;
    expect(fileParts).toHaveLength(1);
    expect(fileParts[0]!.filename).toBe('tool-image-tc-ss-0.jpg');
    expect(fileParts[0]!.mediaType).toBe('image/jpeg');
    expect(fileParts[0]!.data).toBe('base64screenshotdata');
  });
});

// ── thinkingSignature preservation ──
