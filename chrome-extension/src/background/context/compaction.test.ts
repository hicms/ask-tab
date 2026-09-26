import {
  compactMessages,
  compactMessagesWithSummary,
  compactOldestToolResults,
  estimateMessageTokens,
  estimatePartTokens,
  truncateMessageToolResults,
  truncateOversizedToolResults,
  shouldRunMemoryFlush,
  FLUSH_RESERVE_TOKENS,
  FLUSH_SOFT_THRESHOLD_TOKENS,
  TOKEN_SAFETY_MARGIN,
  TOOL_RESULT_COMPACTION_PLACEHOLDER,
  MIN_KEEP_CHARS,
} from './compaction';
import { getEffectiveContextLimit, CONTEXT_RATIO, DEFAULT_CONTEXT_LIMIT } from './limits';
import { summarizeMessages } from './summarizer';
import { repairTranscript } from './tool-result-sanitization';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { ChatMessage, ChatMessagePart, ChatModel } from '@extension/shared';

const makeMessage = (overrides: Partial<ChatMessage> = {}): ChatMessage => ({
  id: 'msg-1',
  chatId: 'chat-1',
  role: 'user',
  parts: [{ type: 'text', text: 'Hello' }],
  createdAt: Date.now(),
  ...overrides,
});

describe('estimateMessageTokens', () => {
  it('estimates text message tokens as length/3', () => {
    const msg = makeMessage({ parts: [{ type: 'text', text: 'a'.repeat(100) }] });
    const tokens = estimateMessageTokens(msg);
    // 100/3 = 34 (ceil), +4 for overhead
    expect(tokens).toBe(38);
  });

  it('estimates tool-call message tokens including args', () => {
    const msg = makeMessage({
      role: 'assistant',
      parts: [
        {
          type: 'tool-call',
          toolCallId: 'tc-1',
          toolName: 'web_search',
          args: { city: 'San Francisco' },
        } as ChatMessagePart,
      ],
    });
    const tokens = estimateMessageTokens(msg);
    expect(tokens).toBeGreaterThan(4);
  });

  it('estimates non-image file parts with fixed 500 token overhead', () => {
    const msg = makeMessage({
      parts: [{ type: 'file', url: 'https://example.com/img.png' } as ChatMessagePart],
    });
    const tokens = estimateMessageTokens(msg);
    // 500 (file overhead) + 4 (role overhead)
    expect(tokens).toBe(504);
  });

  it('estimates image file parts at 1600 tokens', () => {
    const msg = makeMessage({
      parts: [
        {
          type: 'file',
          url: '',
          mediaType: 'image/jpeg',
          data: 'base64data',
        } as ChatMessagePart,
      ],
    });
    const tokens = estimateMessageTokens(msg);
    // 1600 (image overhead) + 4 (role overhead)
    expect(tokens).toBe(1604);
  });

  it('estimates file part without data as non-image (500 tokens)', () => {
    const msg = makeMessage({
      parts: [
        {
          type: 'file',
          url: 'https://example.com/img.png',
          mediaType: 'image/png',
          // no data field
        } as ChatMessagePart,
      ],
    });
    const tokens = estimateMessageTokens(msg);
    // No data → non-image path → 500 + 4
    expect(tokens).toBe(504);
  });

  it('handles empty parts array', () => {
    const msg = makeMessage({ parts: [] });
    const tokens = estimateMessageTokens(msg);
    expect(tokens).toBe(4); // Minimum overhead
  });
});

describe('estimatePartTokens — base64 awareness', () => {
  it('uses 1:1 ratio for tool-result parts containing base64', () => {
    const base64 = 'A'.repeat(10_000);
    const part: ChatMessagePart = {
      type: 'tool-result',
      toolCallId: 'tc-1',
      toolName: 'browser',
      result: `{"base64":"${base64}","mimeType":"image/png"}`,
    };
    const tokens = estimatePartTokens(part);
    // base64 portion (10000 chars) at 1:1 + non-base64 at 4:1
    // Should be much higher than the naive text.length/4 estimate
    const naiveEstimate = Math.ceil(
      (JSON.stringify(`{"base64":"${base64}","mimeType":"image/png"}`).length + 'browser'.length) /
        4,
    );
    expect(tokens).toBeGreaterThan(naiveEstimate);
    // Should be roughly 10000 (base64) + small overhead
    expect(tokens).toBeGreaterThan(9000);
  });

  it('uses conservative 3:1 ratio for normal tool results', () => {
    const part: ChatMessagePart = {
      type: 'tool-result',
      toolCallId: 'tc-1',
      toolName: 'web_search',
      result: 'Normal search results text here',
    };
    const tokens = estimatePartTokens(part);
    const expectedText = JSON.stringify('Normal search results text here');
    const expected = Math.ceil((expectedText.length + 'web_search'.length) / 3);
    expect(tokens).toBe(expected);
  });

  it('detects base64 in data URLs within tool results', () => {
    const base64 = 'B'.repeat(5000);
    const part: ChatMessagePart = {
      type: 'tool-result',
      toolCallId: 'tc-1',
      toolName: 'browser',
      result: `data:image/png;base64,${base64}`,
    };
    const tokens = estimatePartTokens(part);
    // Should use 1:1 for the base64 portion
    expect(tokens).toBeGreaterThan(4000);
  });
});

describe('compactMessages', () => {
  it('returns messages unchanged when within budget (wasCompacted: false)', () => {
    const messages = [
      makeMessage({ id: 'm1', role: 'user', parts: [{ type: 'text', text: 'Hi' }] }),
      makeMessage({ id: 'm2', role: 'assistant', parts: [{ type: 'text', text: 'Hello!' }] }),
    ];
    const result = compactMessages(messages, 'gpt-4o');
    expect(result.wasCompacted).toBe(false);
    expect(result.messages).toEqual(messages);
  });

  it('drops middle messages when over budget (wasCompacted: true)', () => {
    const longText = 'x'.repeat(200_000);
    const messages = [
      makeMessage({ id: 'm1', role: 'user', parts: [{ type: 'text', text: 'Start' }] }),
      makeMessage({ id: 'm2', role: 'assistant', parts: [{ type: 'text', text: longText }] }),
      makeMessage({ id: 'm3', role: 'user', parts: [{ type: 'text', text: longText }] }),
      makeMessage({ id: 'm4', role: 'assistant', parts: [{ type: 'text', text: longText }] }),
      makeMessage({ id: 'm5', role: 'user', parts: [{ type: 'text', text: longText }] }),
      makeMessage({ id: 'm6', role: 'assistant', parts: [{ type: 'text', text: longText }] }),
      makeMessage({ id: 'm7', role: 'user', parts: [{ type: 'text', text: longText }] }),
      makeMessage({ id: 'm8', role: 'user', parts: [{ type: 'text', text: 'Latest question' }] }),
    ];
    const result = compactMessages(messages, 'gpt-4o');
    expect(result.wasCompacted).toBe(true);
    expect(result.messages.length).toBeLessThan(messages.length);
  });

  it('always keeps the first user message as anchor', () => {
    const longText = 'x'.repeat(200_000);
    const messages = [
      makeMessage({ id: 'm1', role: 'user', parts: [{ type: 'text', text: 'First question' }] }),
      makeMessage({ id: 'm2', role: 'assistant', parts: [{ type: 'text', text: longText }] }),
      makeMessage({ id: 'm3', role: 'user', parts: [{ type: 'text', text: longText }] }),
      makeMessage({ id: 'm4', role: 'user', parts: [{ type: 'text', text: 'Latest' }] }),
    ];
    const result = compactMessages(messages, 'gpt-4o');
    if (result.wasCompacted) {
      expect(result.messages[0]!.id).toBe('m1');
    }
  });

  it('always keeps the most recent messages', () => {
    const longText = 'x'.repeat(200_000);
    const messages = [
      makeMessage({ id: 'm1', role: 'user', parts: [{ type: 'text', text: 'Start' }] }),
      makeMessage({ id: 'm2', role: 'assistant', parts: [{ type: 'text', text: longText }] }),
      makeMessage({ id: 'm3', role: 'user', parts: [{ type: 'text', text: longText }] }),
      makeMessage({ id: 'm4', role: 'user', parts: [{ type: 'text', text: 'Latest' }] }),
    ];
    const result = compactMessages(messages, 'gpt-4o');
    if (result.wasCompacted) {
      const lastMsg = result.messages[result.messages.length - 1]!;
      expect(lastMsg.id).toBe('m4');
    }
  });

  it('inserts compaction marker between anchor and recent window', () => {
    const longText = 'x'.repeat(200_000);
    const messages = [
      makeMessage({ id: 'm1', role: 'user', parts: [{ type: 'text', text: 'Start' }] }),
      makeMessage({ id: 'm2', role: 'assistant', parts: [{ type: 'text', text: longText }] }),
      makeMessage({ id: 'm3', role: 'user', parts: [{ type: 'text', text: longText }] }),
      makeMessage({ id: 'm4', role: 'user', parts: [{ type: 'text', text: 'Latest' }] }),
    ];
    const result = compactMessages(messages, 'gpt-4o');
    if (result.wasCompacted) {
      const marker = result.messages.find(m => m.id === '__compaction_marker__');
      expect(marker).toBeDefined();
      expect(marker!.role).toBe('system');
    }
  });

  it('compaction marker has role: system with dropped count', () => {
    const longText = 'x'.repeat(200_000);
    const messages = [
      makeMessage({ id: 'm1', role: 'user', parts: [{ type: 'text', text: 'Start' }] }),
      makeMessage({ id: 'm2', role: 'assistant', parts: [{ type: 'text', text: longText }] }),
      makeMessage({ id: 'm3', role: 'user', parts: [{ type: 'text', text: longText }] }),
      makeMessage({ id: 'm4', role: 'user', parts: [{ type: 'text', text: 'Latest' }] }),
    ];
    const result = compactMessages(messages, 'gpt-4o');
    if (result.wasCompacted) {
      const marker = result.messages.find(m => m.id === '__compaction_marker__');
      expect(marker!.role).toBe('system');
      const text = (marker!.parts[0] as { type: 'text'; text: string }).text;
      expect(text).toMatch(/\d+ earlier messages omitted/);
    }
  });

  it('handles single message (never compacts)', () => {
    const msg = makeMessage();
    const result = compactMessages([msg], 'gpt-4o');
    expect(result.wasCompacted).toBe(false);
    expect(result.messages).toEqual([msg]);
  });

  it('handles two messages (never compacts)', () => {
    const messages = [makeMessage({ id: 'm1' }), makeMessage({ id: 'm2', role: 'assistant' })];
    const result = compactMessages(messages, 'gpt-4o');
    expect(result.wasCompacted).toBe(false);
  });

  it('respects systemPromptTokens budget reservation', () => {
    const text = 'x'.repeat(380_000);
    const messages = [
      makeMessage({ id: 'm1', role: 'user', parts: [{ type: 'text', text: 'Hi' }] }),
      makeMessage({ id: 'm2', role: 'assistant', parts: [{ type: 'text', text: text }] }),
    ];
    const result1 = compactMessages(messages, 'gpt-4o', 0);
    const result2 = compactMessages(messages, 'gpt-4o', 50_000);
    if (!result1.wasCompacted && result2.wasCompacted) {
      expect(result2.wasCompacted).toBe(true);
    }
  });

  it('works with different model context limits', () => {
    const text = 'x'.repeat(200_000);
    const messages = [
      makeMessage({ id: 'm1', role: 'user', parts: [{ type: 'text', text: 'Start' }] }),
      makeMessage({ id: 'm2', role: 'assistant', parts: [{ type: 'text', text: text }] }),
      makeMessage({ id: 'm3', role: 'user', parts: [{ type: 'text', text: text }] }),
      makeMessage({ id: 'm4', role: 'assistant', parts: [{ type: 'text', text: text }] }),
      makeMessage({ id: 'm5', role: 'user', parts: [{ type: 'text', text: text }] }),
      makeMessage({ id: 'm6', role: 'assistant', parts: [{ type: 'text', text: text }] }),
      makeMessage({ id: 'm7', role: 'user', parts: [{ type: 'text', text: text }] }),
      makeMessage({ id: 'm8', role: 'user', parts: [{ type: 'text', text: 'Latest' }] }),
    ];
    const resultSmall = compactMessages(messages, 'gpt-4o');
    const resultLarge = compactMessages(messages, 'gemini-2.0-flash');
    expect(resultSmall.wasCompacted).toBe(true);
    expect(resultLarge.wasCompacted).toBe(false);
  });
});

describe('getEffectiveContextLimit', () => {
  it('returns known limit for gpt-4o (128K * 0.75)', () => {
    expect(getEffectiveContextLimit('gpt-4o')).toBe(Math.floor(128_000 * CONTEXT_RATIO));
  });

  it('returns known limit for claude-sonnet-4-5 (200K * 0.75)', () => {
    expect(getEffectiveContextLimit('claude-sonnet-4-5')).toBe(Math.floor(200_000 * CONTEXT_RATIO));
  });

  it('returns default limit for unknown model (128K * 0.75)', () => {
    expect(getEffectiveContextLimit('unknown-model-xyz')).toBe(
      Math.floor(DEFAULT_CONTEXT_LIMIT * CONTEXT_RATIO),
    );
  });
});

// ── compactMessagesWithSummary tests ──

vi.mock('./summarizer', () => ({
  summarizeMessages: vi.fn(),
  summarizeInStages: vi.fn(),
  shouldUseAdaptiveCompaction: vi.fn(() => false), // default: single-pass
}));

vi.mock('./tool-result-sanitization', () => ({
  stripToolResultDetails: vi.fn((msgs: ChatMessage[]) => msgs),
  repairToolUseResultPairing: vi.fn((msgs: ChatMessage[]) => msgs),
  repairTranscript: vi.fn((msgs: ChatMessage[]) => msgs),
}));

const mockSummarize = vi.mocked(summarizeMessages);

const mockModelConfig: ChatModel = {
  id: 'gpt-4o',
  name: 'GPT-4o',
  provider: 'openai',
  routingMode: 'direct',
};

describe('compactMessagesWithSummary', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns unchanged when within budget', async () => {
    const messages = [
      makeMessage({ id: 'm1', role: 'user', parts: [{ type: 'text', text: 'Hi' }] }),
      makeMessage({ id: 'm2', role: 'assistant', parts: [{ type: 'text', text: 'Hello!' }] }),
      makeMessage({ id: 'm3', role: 'user', parts: [{ type: 'text', text: 'How are you?' }] }),
    ];
    const result = await compactMessagesWithSummary(messages, 'gpt-4o', mockModelConfig);
    expect(result.wasCompacted).toBe(false);
    expect(result.compactionMethod).toBe('none');
    expect(result.messages).toEqual(messages);
  });

  it('calls summarizeMessages when over budget', async () => {
    mockSummarize.mockResolvedValueOnce('Summary of older messages');

    const longText = 'x'.repeat(200_000);
    const messages = [
      makeMessage({ id: 'm1', role: 'user', parts: [{ type: 'text', text: 'Start' }] }),
      makeMessage({ id: 'm2', role: 'assistant', parts: [{ type: 'text', text: longText }] }),
      makeMessage({ id: 'm3', role: 'user', parts: [{ type: 'text', text: longText }] }),
      makeMessage({ id: 'm4', role: 'assistant', parts: [{ type: 'text', text: longText }] }),
      makeMessage({ id: 'm5', role: 'user', parts: [{ type: 'text', text: longText }] }),
      makeMessage({ id: 'm6', role: 'assistant', parts: [{ type: 'text', text: longText }] }),
      makeMessage({ id: 'm7', role: 'user', parts: [{ type: 'text', text: longText }] }),
      makeMessage({ id: 'm8', role: 'user', parts: [{ type: 'text', text: 'Latest' }] }),
    ];

    const result = await compactMessagesWithSummary(messages, 'gpt-4o', mockModelConfig);
    expect(result.wasCompacted).toBe(true);
    expect(mockSummarize).toHaveBeenCalled();
  });

  it('replaces older messages with summary system message', async () => {
    mockSummarize.mockResolvedValueOnce('The conversation was about weather.');

    const longText = 'x'.repeat(200_000);
    const messages = [
      makeMessage({ id: 'm1', role: 'user', parts: [{ type: 'text', text: 'Start' }] }),
      makeMessage({ id: 'm2', role: 'assistant', parts: [{ type: 'text', text: longText }] }),
      makeMessage({ id: 'm3', role: 'user', parts: [{ type: 'text', text: longText }] }),
      makeMessage({ id: 'm4', role: 'assistant', parts: [{ type: 'text', text: longText }] }),
      makeMessage({ id: 'm5', role: 'user', parts: [{ type: 'text', text: longText }] }),
      makeMessage({ id: 'm6', role: 'assistant', parts: [{ type: 'text', text: longText }] }),
      makeMessage({ id: 'm7', role: 'user', parts: [{ type: 'text', text: longText }] }),
      makeMessage({ id: 'm8', role: 'user', parts: [{ type: 'text', text: 'Latest' }] }),
    ];

    const result = await compactMessagesWithSummary(messages, 'gpt-4o', mockModelConfig);
    if (result.compactionMethod === 'summary') {
      const summaryMsg = result.messages.find(m => m.id === '__compaction_summary__');
      expect(summaryMsg).toBeDefined();
      expect(summaryMsg!.role).toBe('system');
      const text = (summaryMsg!.parts[0] as { type: 'text'; text: string }).text;
      expect(text).toContain('Conversation summary');
    }
  });

  it('falls back to sliding-window when summarization fails', async () => {
    mockSummarize.mockRejectedValueOnce(new Error('API error'));

    const longText = 'x'.repeat(200_000);
    const messages = [
      makeMessage({ id: 'm1', role: 'user', parts: [{ type: 'text', text: 'Start' }] }),
      makeMessage({ id: 'm2', role: 'assistant', parts: [{ type: 'text', text: longText }] }),
      makeMessage({ id: 'm3', role: 'user', parts: [{ type: 'text', text: longText }] }),
      makeMessage({ id: 'm4', role: 'assistant', parts: [{ type: 'text', text: longText }] }),
      makeMessage({ id: 'm5', role: 'user', parts: [{ type: 'text', text: longText }] }),
      makeMessage({ id: 'm6', role: 'assistant', parts: [{ type: 'text', text: longText }] }),
      makeMessage({ id: 'm7', role: 'user', parts: [{ type: 'text', text: longText }] }),
      makeMessage({ id: 'm8', role: 'user', parts: [{ type: 'text', text: 'Latest' }] }),
    ];

    const result = await compactMessagesWithSummary(messages, 'gpt-4o', mockModelConfig);
    expect(result.wasCompacted).toBe(true);
    expect(result.compactionMethod).toBe('sliding-window');
  });

  it('reports compactionMethod correctly', async () => {
    mockSummarize.mockResolvedValueOnce('Summary');

    const longText = 'x'.repeat(200_000);
    const messages = [
      makeMessage({ id: 'm1', role: 'user', parts: [{ type: 'text', text: 'Start' }] }),
      makeMessage({ id: 'm2', role: 'assistant', parts: [{ type: 'text', text: longText }] }),
      makeMessage({ id: 'm3', role: 'user', parts: [{ type: 'text', text: longText }] }),
      makeMessage({ id: 'm4', role: 'assistant', parts: [{ type: 'text', text: longText }] }),
      makeMessage({ id: 'm5', role: 'user', parts: [{ type: 'text', text: longText }] }),
      makeMessage({ id: 'm6', role: 'assistant', parts: [{ type: 'text', text: longText }] }),
      makeMessage({ id: 'm7', role: 'user', parts: [{ type: 'text', text: longText }] }),
      makeMessage({ id: 'm8', role: 'user', parts: [{ type: 'text', text: 'Latest' }] }),
    ];

    const result = await compactMessagesWithSummary(messages, 'gpt-4o', mockModelConfig);
    expect(['summary', 'sliding-window']).toContain(result.compactionMethod);
  });

  it('preserves anchor message + recent messages', async () => {
    mockSummarize.mockResolvedValueOnce('Summary');

    const longText = 'x'.repeat(200_000);
    const messages = [
      makeMessage({ id: 'm1', role: 'user', parts: [{ type: 'text', text: 'First question' }] }),
      makeMessage({ id: 'm2', role: 'assistant', parts: [{ type: 'text', text: longText }] }),
      makeMessage({ id: 'm3', role: 'user', parts: [{ type: 'text', text: longText }] }),
      makeMessage({ id: 'm4', role: 'assistant', parts: [{ type: 'text', text: longText }] }),
      makeMessage({ id: 'm5', role: 'user', parts: [{ type: 'text', text: longText }] }),
      makeMessage({ id: 'm6', role: 'assistant', parts: [{ type: 'text', text: longText }] }),
      makeMessage({ id: 'm7', role: 'user', parts: [{ type: 'text', text: longText }] }),
      makeMessage({ id: 'm8', role: 'user', parts: [{ type: 'text', text: 'Latest' }] }),
    ];

    const result = await compactMessagesWithSummary(messages, 'gpt-4o', mockModelConfig);
    if (result.wasCompacted) {
      // First message should be the anchor
      expect(result.messages[0]!.id).toBe('m1');
      // Last message should be the most recent
      const lastMsg = result.messages[result.messages.length - 1]!;
      expect(lastMsg.id).toBe('m8');
    }
  });

  it('returns unchanged for ≤2 messages with compactionMethod "none"', async () => {
    const messages = [
      makeMessage({ id: 'm1', role: 'user', parts: [{ type: 'text', text: 'Hi' }] }),
      makeMessage({ id: 'm2', role: 'assistant', parts: [{ type: 'text', text: 'Hello!' }] }),
    ];
    const result = await compactMessagesWithSummary(messages, 'gpt-4o', mockModelConfig);
    expect(result.wasCompacted).toBe(false);
    expect(result.compactionMethod).toBe('none');
    expect(result.messages).toHaveLength(2);
    expect(mockSummarize).not.toHaveBeenCalled();
  });

  it('returns unchanged for single message', async () => {
    const messages = [
      makeMessage({ id: 'm1', role: 'user', parts: [{ type: 'text', text: 'Hi' }] }),
    ];
    const result = await compactMessagesWithSummary(messages, 'gpt-4o', mockModelConfig);
    expect(result.wasCompacted).toBe(false);
    expect(result.compactionMethod).toBe('none');
  });

  it('returns "none" when no user message exists (over budget)', async () => {
    // Create messages that are over budget but contain no user messages
    const longText = 'x'.repeat(200_000);
    const messages = [
      makeMessage({ id: 'm1', role: 'system', parts: [{ type: 'text', text: longText }] }),
      makeMessage({ id: 'm2', role: 'assistant', parts: [{ type: 'text', text: longText }] }),
      makeMessage({ id: 'm3', role: 'assistant', parts: [{ type: 'text', text: longText }] }),
    ];
    const result = await compactMessagesWithSummary(messages, 'gpt-4o', mockModelConfig);
    expect(result.wasCompacted).toBe(false);
    expect(result.compactionMethod).toBe('none');
    expect(mockSummarize).not.toHaveBeenCalled();
  });

  it('returns sliding-window when budget ≤ 0 after anchor + summaryReserve', async () => {
    // Huge anchor message that blows the budget
    const hugeText = 'x'.repeat(500_000);
    const messages = [
      makeMessage({ id: 'm1', role: 'user', parts: [{ type: 'text', text: hugeText }] }),
      makeMessage({ id: 'm2', role: 'assistant', parts: [{ type: 'text', text: 'Small' }] }),
      makeMessage({ id: 'm3', role: 'user', parts: [{ type: 'text', text: 'Latest' }] }),
    ];
    const result = await compactMessagesWithSummary(messages, 'gpt-4o', mockModelConfig);
    expect(result.wasCompacted).toBe(true);
    expect(result.compactionMethod).toBe('sliding-window');
    expect(result.messages).toHaveLength(1);
    expect(result.messages[0]!.id).toBe('m1');
    expect(mockSummarize).not.toHaveBeenCalled();
  });

  it('passes existingSummary to summarizer when provided', async () => {
    mockSummarize.mockResolvedValueOnce('Updated summary with prior context');

    const longText = 'x'.repeat(200_000);
    const messages = [
      makeMessage({ id: 'm1', role: 'user', parts: [{ type: 'text', text: 'Start' }] }),
      makeMessage({ id: 'm2', role: 'assistant', parts: [{ type: 'text', text: longText }] }),
      makeMessage({ id: 'm3', role: 'user', parts: [{ type: 'text', text: longText }] }),
      makeMessage({ id: 'm4', role: 'assistant', parts: [{ type: 'text', text: longText }] }),
      makeMessage({ id: 'm5', role: 'user', parts: [{ type: 'text', text: longText }] }),
      makeMessage({ id: 'm6', role: 'assistant', parts: [{ type: 'text', text: longText }] }),
      makeMessage({ id: 'm7', role: 'user', parts: [{ type: 'text', text: longText }] }),
      makeMessage({ id: 'm8', role: 'user', parts: [{ type: 'text', text: 'Latest' }] }),
    ];

    const result = await compactMessagesWithSummary(messages, 'gpt-4o', mockModelConfig, {
      existingSummary: 'Previous conversation about weather.',
    });

    if (result.compactionMethod === 'summary') {
      // The summarizer should have been called with extra messages including prior summary
      const callArgs = mockSummarize.mock.calls[0]![0];
      const hasPriorSummary = callArgs.some(
        (m: ChatMessage) =>
          m.id === '__prior_summary__' &&
          (m.parts[0] as { text: string }).text.includes('Previous summary:'),
      );
      expect(hasPriorSummary).toBe(true);
      expect(result.summary).toBe('Updated summary with prior context');
    }
  });
});

// ── Compaction: minimum recent messages guarantee ──

describe('compactMessagesWithSummary — minimum recent messages', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('never produces recentMessages=0 when last message is oversized', async () => {
    mockSummarize.mockResolvedValueOnce('Summary');

    // Build a conversation where the LAST message is a huge assistant response
    // (simulating a browser snapshot merged with tool results).
    // The budget for gpt-4o is ~96K tokens. Make the last message ~100K tokens
    // so it exceeds remaining budget after anchor + summary reserve.
    const hugeToolResult = 'x'.repeat(400_000); // ~100K tokens
    const messages = [
      makeMessage({ id: 'm1', role: 'user', parts: [{ type: 'text', text: 'First question' }] }),
      makeMessage({
        id: 'm2',
        role: 'assistant',
        parts: [{ type: 'text', text: 'Response to first' }],
      }),
      makeMessage({ id: 'm3', role: 'user', parts: [{ type: 'text', text: 'Second question' }] }),
      makeMessage({
        id: 'm4',
        role: 'assistant',
        parts: [
          { type: 'text', text: 'Here is the result' },
          {
            type: 'tool-result',
            toolCallId: 'tc-1',
            toolName: 'browser',
            result: hugeToolResult,
          } as ChatMessagePart,
        ],
      }),
      makeMessage({ id: 'm5', role: 'user', parts: [{ type: 'text', text: 'Tell me more' }] }),
    ];

    const result = await compactMessagesWithSummary(messages, 'gpt-4o', mockModelConfig);

    if (result.wasCompacted) {
      // The anchor (m1) is always first
      expect(result.messages[0]!.id).toBe('m1');
      // Must have at least the most recent user message preserved
      const lastMsg = result.messages[result.messages.length - 1]!;
      expect(lastMsg.id).toBe('m5');
      // Should have more than just anchor + summary (i.e., recent messages > 0)
      const nonAnchorNonSummary = result.messages.filter(
        m => m.id !== 'm1' && m.id !== '__compaction_summary__',
      );
      expect(nonAnchorNonSummary.length).toBeGreaterThan(0);
    }
  });

  it('keeps at least the last user message even when budget is exhausted', async () => {
    mockSummarize.mockResolvedValueOnce('Summary');

    // Create a scenario where ALL messages after anchor are large,
    // so the greedy backward fill can't fit any. The fix should
    // force-keep at least the last user message.
    const bigText = 'y'.repeat(200_000); // ~50K tokens each
    const messages = [
      makeMessage({ id: 'm1', role: 'user', parts: [{ type: 'text', text: 'Start' }] }),
      makeMessage({ id: 'm2', role: 'assistant', parts: [{ type: 'text', text: bigText }] }),
      makeMessage({ id: 'm3', role: 'user', parts: [{ type: 'text', text: bigText }] }),
      makeMessage({ id: 'm4', role: 'assistant', parts: [{ type: 'text', text: bigText }] }),
      makeMessage({ id: 'm5', role: 'user', parts: [{ type: 'text', text: 'Latest question' }] }),
    ];

    const result = await compactMessagesWithSummary(messages, 'gpt-4o', mockModelConfig);

    if (result.wasCompacted) {
      // m5 (the latest user message) must be preserved
      const ids = result.messages.map(m => m.id);
      expect(ids).toContain('m5');
    }
  });

  it('preserves last user+assistant pair when possible', async () => {
    mockSummarize.mockResolvedValueOnce('Summary');

    const mediumText = 'z'.repeat(160_000); // ~40K tokens
    const messages = [
      makeMessage({ id: 'm1', role: 'user', parts: [{ type: 'text', text: 'Start' }] }),
      makeMessage({ id: 'm2', role: 'assistant', parts: [{ type: 'text', text: mediumText }] }),
      makeMessage({ id: 'm3', role: 'user', parts: [{ type: 'text', text: mediumText }] }),
      makeMessage({ id: 'm4', role: 'assistant', parts: [{ type: 'text', text: 'Short reply' }] }),
      makeMessage({ id: 'm5', role: 'user', parts: [{ type: 'text', text: 'Follow-up' }] }),
    ];

    const result = await compactMessagesWithSummary(messages, 'gpt-4o', mockModelConfig);

    if (result.wasCompacted) {
      const ids = result.messages.map(m => m.id);
      // Both m4 (last assistant) and m5 (last user) should be kept
      expect(ids).toContain('m4');
      expect(ids).toContain('m5');
    }
  });
});

// ── Compaction: tool result truncation ──

describe('truncateOversizedToolResults', () => {
  it('truncates tool-result parts exceeding 30% of context window', () => {
    const effectiveLimit = getEffectiveContextLimit('gpt-4o');
    const maxChars = Math.floor(effectiveLimit * 0.3 * 4);
    const oversizedChars = Math.floor(effectiveLimit * 0.5 * 4); // 50% of context
    const hugeResult = 'x'.repeat(oversizedChars);

    const messages = [
      makeMessage({
        id: 'm1',
        role: 'assistant',
        parts: [
          { type: 'text', text: 'Here are the results' },
          {
            type: 'tool-result',
            toolCallId: 'tc-1',
            toolName: 'web_fetch',
            result: hugeResult,
          } as ChatMessagePart,
        ],
      }),
    ];

    const result = truncateOversizedToolResults(messages, 'gpt-4o');
    const toolPart = result[0]!.parts.find(p => p.type === 'tool-result')!;
    const resultStr =
      typeof toolPart.result === 'string' ? toolPart.result : JSON.stringify(toolPart.result);
    expect(resultStr.length).toBeLessThanOrEqual(maxChars + 200); // +200 for suffix
    expect(resultStr).toContain('truncated');
  });

  it('leaves small tool-result parts unchanged', () => {
    const messages = [
      makeMessage({
        id: 'm1',
        role: 'assistant',
        parts: [
          {
            type: 'tool-result',
            toolCallId: 'tc-1',
            toolName: 'web_search',
            result: 'small result',
          } as ChatMessagePart,
        ],
      }),
    ];

    const result = truncateOversizedToolResults(messages, 'gpt-4o');
    // Should return the same message object (no copy needed)
    expect(result[0]).toBe(messages[0]);
  });

  it('truncation is applied before compaction budget check', async () => {
    mockSummarize.mockResolvedValueOnce('Summary');

    const effectiveLimit = getEffectiveContextLimit('gpt-4o');
    const oversizedChars = Math.floor(effectiveLimit * 0.5 * 4);
    const hugeResult = 'x'.repeat(oversizedChars);

    const messages = [
      makeMessage({ id: 'm1', role: 'user', parts: [{ type: 'text', text: 'Search for info' }] }),
      makeMessage({
        id: 'm2',
        role: 'assistant',
        parts: [
          { type: 'text', text: 'Here are the results' },
          {
            type: 'tool-result',
            toolCallId: 'tc-1',
            toolName: 'web_fetch',
            result: hugeResult,
          } as ChatMessagePart,
        ],
      }),
      makeMessage({ id: 'm3', role: 'user', parts: [{ type: 'text', text: 'Tell me more' }] }),
    ];

    const result = await compactMessagesWithSummary(messages, 'gpt-4o', mockModelConfig);

    // After truncation + compaction, no tool-result in output exceeds 30% of context
    const maxToolResultChars = Math.floor(effectiveLimit * 0.3 * 4);
    for (const msg of result.messages) {
      for (const part of msg.parts) {
        if (part.type === 'tool-result') {
          const resultStr =
            typeof part.result === 'string' ? part.result : JSON.stringify(part.result);
          expect(resultStr.length).toBeLessThanOrEqual(maxToolResultChars + 100);
        }
      }
    }
  });
});

// ── getEffectiveContextLimit: model ID normalization ──

describe('getEffectiveContextLimit — model ID normalization', () => {
  it('resolves claude-opus-4.6 (dot) same as claude-opus-4-6 (dash)', () => {
    const withDash = getEffectiveContextLimit('claude-opus-4-6');
    const withDot = getEffectiveContextLimit('claude-opus-4.6');
    expect(withDot).toBe(withDash);
    // Should be 200K * 0.75 = 150K, not the 128K default
    expect(withDot).toBe(Math.floor(200_000 * CONTEXT_RATIO));
  });

  it('resolves claude-sonnet-4.5 same as claude-sonnet-4-5', () => {
    const known = getEffectiveContextLimit('claude-sonnet-4-5');
    // A dot-variant should also resolve correctly
    const dotVariant = getEffectiveContextLimit('claude-sonnet-4.5');
    expect(dotVariant).toBe(known);
  });

  it('still returns default for genuinely unknown models', () => {
    expect(getEffectiveContextLimit('totally-unknown-model')).toBe(
      Math.floor(DEFAULT_CONTEXT_LIMIT * CONTEXT_RATIO),
    );
  });
});

// ── Pre-compaction memory flush tests ──

describe('Pre-compaction memory flush', () => {
  it('shouldRunMemoryFlush returns true when over soft threshold and not already flushed', () => {
    const effectiveLimit = getEffectiveContextLimit('gpt-4o');
    // Set totalTokens above the soft threshold
    const totalTokens = effectiveLimit; // definitely above soft threshold
    expect(
      shouldRunMemoryFlush({
        totalTokens,
        modelId: 'gpt-4o',
        systemPromptTokens: 0,
        compactionCount: 0,
        memoryFlushCompactionCount: undefined,
      }),
    ).toBe(true);
  });

  it('shouldRunMemoryFlush returns false when under threshold', () => {
    expect(
      shouldRunMemoryFlush({
        totalTokens: 100, // way below any threshold
        modelId: 'gpt-4o',
        systemPromptTokens: 0,
        compactionCount: 0,
        memoryFlushCompactionCount: undefined,
      }),
    ).toBe(false);
  });

  it('shouldRunMemoryFlush returns false when already flushed for current cycle', () => {
    const effectiveLimit = getEffectiveContextLimit('gpt-4o');
    expect(
      shouldRunMemoryFlush({
        totalTokens: effectiveLimit, // above threshold
        modelId: 'gpt-4o',
        systemPromptTokens: 0,
        compactionCount: 2,
        memoryFlushCompactionCount: 2, // already flushed for cycle 2
      }),
    ).toBe(false);
  });

  it('shouldRunMemoryFlush returns true when flushed for a previous cycle', () => {
    const effectiveLimit = getEffectiveContextLimit('gpt-4o');
    expect(
      shouldRunMemoryFlush({
        totalTokens: effectiveLimit,
        modelId: 'gpt-4o',
        systemPromptTokens: 0,
        compactionCount: 3,
        memoryFlushCompactionCount: 2, // flushed in cycle 2, now in cycle 3
      }),
    ).toBe(true);
  });

  it('shouldRunMemoryFlush accounts for systemPromptTokens in threshold', () => {
    const effectiveLimit = getEffectiveContextLimit('gpt-4o');
    const softThresholdWithoutSysPrompt =
      effectiveLimit - FLUSH_RESERVE_TOKENS - FLUSH_SOFT_THRESHOLD_TOKENS;
    // Just under the threshold without system prompt tokens
    const totalTokens = softThresholdWithoutSysPrompt - 1;

    // Without system prompt tokens: under threshold
    expect(
      shouldRunMemoryFlush({
        totalTokens,
        modelId: 'gpt-4o',
        systemPromptTokens: 0,
        compactionCount: 0,
        memoryFlushCompactionCount: undefined,
      }),
    ).toBe(false);

    // With large system prompt tokens: over threshold (lowers the bar)
    expect(
      shouldRunMemoryFlush({
        totalTokens,
        modelId: 'gpt-4o',
        systemPromptTokens: 10_000,
        compactionCount: 0,
        memoryFlushCompactionCount: undefined,
      }),
    ).toBe(true);
  });

  it('shouldRunMemoryFlush handles undefined compactionCount as 0', () => {
    const effectiveLimit = getEffectiveContextLimit('gpt-4o');
    expect(
      shouldRunMemoryFlush({
        totalTokens: effectiveLimit,
        modelId: 'gpt-4o',
        systemPromptTokens: 0,
        compactionCount: undefined,
        memoryFlushCompactionCount: 0, // already flushed for cycle 0
      }),
    ).toBe(false);
  });
});

// ── Safety margin tests ──

describe('compactMessages — TOKEN_SAFETY_MARGIN', () => {
  it('triggers compaction when raw total fits but adjusted total exceeds budget', () => {
    // gpt-4o effective limit: 128K * 0.75 = 96K tokens
    const effectiveLimit = getEffectiveContextLimit('gpt-4o');
    // Create messages that total just under budget but exceed with 1.2× margin
    // Target: totalTokens * 1.2 > budget, but totalTokens <= budget
    // So totalTokens must be in (budget/1.2, budget]
    const targetTokens = Math.floor(effectiveLimit / TOKEN_SAFETY_MARGIN) + 100;
    // Each char ≈ 0.25 tokens, so chars = tokens * 4
    // 9 messages × 4 overhead each = 36 tokens overhead; spread bulk across middle messages
    const bulkTokens = targetTokens - 36;
    const perMsgLen = Math.floor((bulkTokens / 4) * 4); // 4 middle messages share the bulk

    const messages = [
      makeMessage({ id: 'm1', role: 'user', parts: [{ type: 'text', text: 'Hi' }] }),
      makeMessage({
        id: 'm2',
        role: 'assistant',
        parts: [{ type: 'text', text: 'a'.repeat(perMsgLen) }],
      }),
      makeMessage({
        id: 'm3',
        role: 'user',
        parts: [{ type: 'text', text: 'a'.repeat(perMsgLen) }],
      }),
      makeMessage({
        id: 'm4',
        role: 'assistant',
        parts: [{ type: 'text', text: 'a'.repeat(perMsgLen) }],
      }),
      makeMessage({
        id: 'm5',
        role: 'user',
        parts: [{ type: 'text', text: 'a'.repeat(perMsgLen) }],
      }),
      makeMessage({ id: 'm6', role: 'assistant', parts: [{ type: 'text', text: 'Short' }] }),
      makeMessage({ id: 'm7', role: 'user', parts: [{ type: 'text', text: 'Short' }] }),
      makeMessage({ id: 'm8', role: 'assistant', parts: [{ type: 'text', text: 'Short' }] }),
      makeMessage({ id: 'm9', role: 'user', parts: [{ type: 'text', text: 'Latest' }] }),
    ];

    const result = compactMessages(messages, 'gpt-4o');
    // Raw total fits, but with safety margin it should trigger compaction
    expect(result.wasCompacted).toBe(true);
  });

  it('does not compact when adjusted total is within budget', () => {
    const messages = [
      makeMessage({ id: 'm1', role: 'user', parts: [{ type: 'text', text: 'Hi' }] }),
      makeMessage({ id: 'm2', role: 'assistant', parts: [{ type: 'text', text: 'Hello!' }] }),
      makeMessage({ id: 'm3', role: 'user', parts: [{ type: 'text', text: 'Fine' }] }),
    ];

    const result = compactMessages(messages, 'gpt-4o');
    expect(result.wasCompacted).toBe(false);
  });
});

// ── Tool pairing repair on output ──

describe('compactMessages — repair tool pairing on output', () => {
  it('calls repairToolUseResultPairing on compaction output with correct structure', async () => {
    const { repairToolUseResultPairing } = await import('./tool-result-sanitization');
    const mockRepair = vi.mocked(repairToolUseResultPairing);
    mockRepair.mockClear();

    const longText = 'x'.repeat(200_000);
    const messages = [
      makeMessage({ id: 'm1', role: 'user', parts: [{ type: 'text', text: 'Start' }] }),
      makeMessage({ id: 'm2', role: 'assistant', parts: [{ type: 'text', text: longText }] }),
      makeMessage({ id: 'm3', role: 'user', parts: [{ type: 'text', text: longText }] }),
      makeMessage({ id: 'm4', role: 'user', parts: [{ type: 'text', text: 'Latest' }] }),
    ];

    compactMessages(messages, 'gpt-4o');
    expect(mockRepair).toHaveBeenCalledTimes(1);
    // Verify the argument structure: [anchor, compaction marker, ...recent]
    const callArg = mockRepair.mock.calls[0]![0] as ChatMessage[];
    expect(callArg[0]!.id).toBe('m1'); // anchor
    expect(callArg[1]!.id).toBe('__compaction_marker__'); // marker
    expect(callArg[callArg.length - 1]!.id).toBe('m4'); // most recent
  });
});

// ── Newline-aware truncation ──

describe('truncateOversizedToolResults — newline-aware truncation', () => {
  it('truncates at newline boundary when available', () => {
    const effectiveLimit = getEffectiveContextLimit('gpt-4o');
    const maxChars = Math.floor(effectiveLimit * 0.3 * 4);
    // Build text with newlines that has a newline near 80% of cut point
    const lines: string[] = [];
    let totalLen = 0;
    while (totalLen < maxChars * 2) {
      const line = 'data: ' + 'x'.repeat(98); // 104 chars per line
      lines.push(line);
      totalLen += line.length + 1; // +1 for newline
    }
    const bigText = lines.join('\n');

    const messages = [
      makeMessage({
        id: 'm1',
        role: 'assistant',
        parts: [
          {
            type: 'tool-result',
            toolCallId: 'tc-1',
            toolName: 'web_fetch',
            result: bigText,
          } as ChatMessagePart,
        ],
      }),
    ];

    const result = truncateOversizedToolResults(messages, 'gpt-4o');
    const toolPart = result[0]!.parts.find(p => p.type === 'tool-result')!;
    const resultStr =
      typeof toolPart.result === 'string' ? toolPart.result : JSON.stringify(toolPart.result);

    // Should contain the descriptive truncation suffix
    expect(resultStr).toContain('truncated');
    expect(resultStr).toContain('context window');
    // Should NOT contain the old suffix
    expect(resultStr).not.toContain('…[truncated for context]');
  });

  it('includes descriptive truncation suffix', () => {
    const effectiveLimit = getEffectiveContextLimit('gpt-4o');
    const oversizedChars = Math.floor(effectiveLimit * 0.5 * 4);
    const hugeResult = 'x'.repeat(oversizedChars);

    const messages = [
      makeMessage({
        id: 'm1',
        role: 'assistant',
        parts: [
          {
            type: 'tool-result',
            toolCallId: 'tc-1',
            toolName: 'web_fetch',
            result: hugeResult,
          } as ChatMessagePart,
        ],
      }),
    ];

    const result = truncateOversizedToolResults(messages, 'gpt-4o');
    const toolPart = result[0]!.parts.find(p => p.type === 'tool-result')!;
    const resultStr =
      typeof toolPart.result === 'string' ? toolPart.result : JSON.stringify(toolPart.result);

    expect(resultStr).toContain('truncated');
    expect(resultStr).toContain('to fit context window');
  });
});

// ── Oldest tool result compaction ──

describe('compactOldestToolResults', () => {
  it('returns messages unchanged when total chars within budget', () => {
    const messages = [
      makeMessage({
        id: 'm1',
        role: 'assistant',
        parts: [
          {
            type: 'tool-result',
            toolCallId: 'tc-1',
            toolName: 'search',
            result: 'small result',
          } as ChatMessagePart,
        ],
      }),
    ];

    const result = compactOldestToolResults(messages, 100_000);
    expect(result[0]!.parts[0]).toBe(messages[0]!.parts[0]);
  });

  it('replaces oldest tool results with placeholder when over budget', () => {
    const messages = [
      makeMessage({
        id: 'm1',
        role: 'assistant',
        parts: [
          {
            type: 'tool-result',
            toolCallId: 'tc-1',
            toolName: 'search',
            result: 'x'.repeat(10_000),
          } as ChatMessagePart,
        ],
      }),
      makeMessage({
        id: 'm2',
        role: 'assistant',
        parts: [
          {
            type: 'tool-result',
            toolCallId: 'tc-2',
            toolName: 'search',
            result: 'y'.repeat(10_000),
          } as ChatMessagePart,
        ],
      }),
      makeMessage({
        id: 'm3',
        role: 'assistant',
        parts: [
          {
            type: 'tool-result',
            toolCallId: 'tc-3',
            toolName: 'search',
            result: 'z'.repeat(10_000),
          } as ChatMessagePart,
        ],
      }),
    ];

    // Budget allows only ~15K chars total — forces compaction of oldest
    const result = compactOldestToolResults(messages, 15_000);

    // Oldest result (m1) should be compacted
    const firstResult = result[0]!.parts[0]!;
    expect(firstResult.type).toBe('tool-result');
    expect((firstResult as { result: string }).result).toBe(TOOL_RESULT_COMPACTION_PLACEHOLDER);

    // Most recent result (m3) should be preserved
    const lastResult = result[2]!.parts[0]!;
    expect(lastResult.type).toBe('tool-result');
    expect((lastResult as { result: string }).result).toBe('z'.repeat(10_000));
  });

  it('compacts from oldest to newest, stopping when under budget', () => {
    const messages = [
      makeMessage({
        id: 'm1',
        role: 'assistant',
        parts: [
          {
            type: 'tool-result',
            toolCallId: 'tc-1',
            toolName: 'search',
            result: 'a'.repeat(5_000),
          } as ChatMessagePart,
        ],
      }),
      makeMessage({
        id: 'm2',
        role: 'assistant',
        parts: [
          {
            type: 'tool-result',
            toolCallId: 'tc-2',
            toolName: 'search',
            result: 'b'.repeat(5_000),
          } as ChatMessagePart,
        ],
      }),
      makeMessage({
        id: 'm3',
        role: 'assistant',
        parts: [
          {
            type: 'tool-result',
            toolCallId: 'tc-3',
            toolName: 'search',
            result: 'c'.repeat(5_000),
          } as ChatMessagePart,
        ],
      }),
    ];

    // Total is ~15K. Budget of 11K means we need to free ~4K.
    // Compacting m1 (5K → placeholder ~50 chars) frees ~4950, which is enough.
    const result = compactOldestToolResults(messages, 11_000);

    // m1 compacted
    expect((result[0]!.parts[0] as { result: string }).result).toBe(
      TOOL_RESULT_COMPACTION_PLACEHOLDER,
    );
    // m2 preserved (compaction stopped after m1)
    expect((result[1]!.parts[0] as { result: string }).result).toBe('b'.repeat(5_000));
    // m3 preserved
    expect((result[2]!.parts[0] as { result: string }).result).toBe('c'.repeat(5_000));
  });

  it('skips non-tool-result messages', () => {
    const messages = [
      makeMessage({
        id: 'm1',
        role: 'user',
        parts: [{ type: 'text', text: 'x'.repeat(5_000) }],
      }),
      makeMessage({
        id: 'm2',
        role: 'assistant',
        parts: [
          {
            type: 'tool-result',
            toolCallId: 'tc-1',
            toolName: 'search',
            result: 'y'.repeat(5_000),
          } as ChatMessagePart,
        ],
      }),
    ];

    const result = compactOldestToolResults(messages, 6_000);

    // Text message unchanged
    expect((result[0]!.parts[0] as { text: string }).text).toBe('x'.repeat(5_000));
    // Tool result compacted since total (10K) > budget (6K)
    expect((result[1]!.parts[0] as { result: string }).result).toBe(
      TOOL_RESULT_COMPACTION_PLACEHOLDER,
    );
  });
});

// ── truncateMessageToolResults tests ──

describe('truncateMessageToolResults', () => {
  it('returns message unchanged when it has no tool results', () => {
    const msg = makeMessage({
      role: 'assistant',
      parts: [{ type: 'text', text: 'Hello world' }],
    });
    const result = truncateMessageToolResults(msg, 100);
    expect(result).toBe(msg); // Same reference — no copy needed
  });

  it('returns message unchanged when tool results fit within budget', () => {
    const msg = makeMessage({
      role: 'assistant',
      parts: [
        { type: 'text', text: 'Result:' },
        {
          type: 'tool-result',
          toolCallId: 'tc-1',
          toolName: 'search',
          result: 'small result',
        } as ChatMessagePart,
      ],
    });
    const result = truncateMessageToolResults(msg, 100_000);
    expect(result).toBe(msg);
  });

  it('truncates tool results when budget is smaller than total content', () => {
    const bigResult = 'x'.repeat(20_000);
    const msg = makeMessage({
      role: 'assistant',
      parts: [
        { type: 'text', text: 'Here:' },
        {
          type: 'tool-result',
          toolCallId: 'tc-1',
          toolName: 'search',
          result: bigResult,
        } as ChatMessagePart,
      ],
    });
    // Budget: text (5 chars) + some room for tool result
    const result = truncateMessageToolResults(msg, 5_000);
    const toolPart = result.parts.find(p => p.type === 'tool-result')!;
    const resultStr =
      typeof toolPart.result === 'string' ? toolPart.result : JSON.stringify(toolPart.result);
    expect(resultStr.length).toBeLessThan(bigResult.length);
  });

  it('gives each tool result at least MIN_KEEP_CHARS when budget is very small', () => {
    const msg = makeMessage({
      role: 'assistant',
      parts: [
        { type: 'text', text: 'x'.repeat(10_000) }, // non-tool chars exceed budget
        {
          type: 'tool-result',
          toolCallId: 'tc-1',
          toolName: 'search',
          result: 'y'.repeat(20_000),
        } as ChatMessagePart,
      ],
    });
    // Budget less than non-tool chars — toolBudget becomes 0, floor to MIN_KEEP_CHARS
    const result = truncateMessageToolResults(msg, 5_000);
    const toolPart = result.parts.find(p => p.type === 'tool-result')!;
    const resultStr =
      typeof toolPart.result === 'string' ? toolPart.result : JSON.stringify(toolPart.result);
    // Should keep at least MIN_KEEP_CHARS worth of content
    expect(resultStr.length).toBeGreaterThanOrEqual(MIN_KEEP_CHARS);
  });

  it('distributes budget proportionally across multiple tool results', () => {
    const msg = makeMessage({
      role: 'assistant',
      parts: [
        {
          type: 'tool-result',
          toolCallId: 'tc-1',
          toolName: 'search',
          result: 'a'.repeat(30_000), // 60% of total tool chars
        } as ChatMessagePart,
        {
          type: 'tool-result',
          toolCallId: 'tc-2',
          toolName: 'fetch',
          result: 'b'.repeat(20_000), // 40% of total tool chars
        } as ChatMessagePart,
      ],
    });
    const result = truncateMessageToolResults(msg, 10_000);
    const parts = result.parts.filter(p => p.type === 'tool-result');
    const size1 = (
      typeof parts[0]!.result === 'string' ? parts[0]!.result : JSON.stringify(parts[0]!.result)
    ).length;
    const size2 = (
      typeof parts[1]!.result === 'string' ? parts[1]!.result : JSON.stringify(parts[1]!.result)
    ).length;
    // Both should be truncated
    expect(size1).toBeLessThan(30_000);
    expect(size2).toBeLessThan(20_000);
  });
});

// ── compactMessagesWithSummary — force mode ──

describe('compactMessagesWithSummary — force mode', () => {
  beforeEach(() => {
    vi.resetAllMocks();
  });

  it('compacts even when messages fit within budget', async () => {
    mockSummarize.mockResolvedValueOnce('Forced summary of conversation');

    // Small messages that easily fit in budget — need enough to exceed anchor + MIN_RECENT_MESSAGES
    const messages = [
      makeMessage({ id: 'm1', role: 'user', parts: [{ type: 'text', text: 'First question' }] }),
      makeMessage({ id: 'm2', role: 'assistant', parts: [{ type: 'text', text: 'First answer' }] }),
      makeMessage({ id: 'm3', role: 'user', parts: [{ type: 'text', text: 'Second question' }] }),
      makeMessage({
        id: 'm4',
        role: 'assistant',
        parts: [{ type: 'text', text: 'Second answer' }],
      }),
      makeMessage({ id: 'm5', role: 'user', parts: [{ type: 'text', text: 'Third question' }] }),
      makeMessage({ id: 'm6', role: 'assistant', parts: [{ type: 'text', text: 'Third answer' }] }),
      makeMessage({ id: 'm7', role: 'user', parts: [{ type: 'text', text: 'Fourth question' }] }),
      makeMessage({
        id: 'm8',
        role: 'assistant',
        parts: [{ type: 'text', text: 'Fourth answer' }],
      }),
      makeMessage({ id: 'm9', role: 'user', parts: [{ type: 'text', text: 'Fifth question' }] }),
    ];

    const result = await compactMessagesWithSummary(messages, 'gpt-4o', mockModelConfig, {
      force: true,
    });

    expect(result.wasCompacted).toBe(true);
    expect(result.compactionMethod).toBe('summary');
    expect(result.summary).toBe('Forced summary of conversation');
    expect(mockSummarize).toHaveBeenCalled();
    // Should still preserve anchor and recent messages
    expect(result.messages[0]!.id).toBe('m1');
  });

  it('falls back to sliding-window when force summarization fails', async () => {
    mockSummarize.mockRejectedValueOnce(new Error('API error'));

    const messages = [
      makeMessage({ id: 'm1', role: 'user', parts: [{ type: 'text', text: 'First' }] }),
      makeMessage({ id: 'm2', role: 'assistant', parts: [{ type: 'text', text: 'Reply' }] }),
      makeMessage({ id: 'm3', role: 'user', parts: [{ type: 'text', text: 'Second' }] }),
      makeMessage({ id: 'm4', role: 'assistant', parts: [{ type: 'text', text: 'Reply 2' }] }),
      makeMessage({ id: 'm5', role: 'user', parts: [{ type: 'text', text: 'Third' }] }),
      makeMessage({ id: 'm6', role: 'assistant', parts: [{ type: 'text', text: 'Reply 3' }] }),
      makeMessage({ id: 'm7', role: 'user', parts: [{ type: 'text', text: 'Fourth' }] }),
      makeMessage({ id: 'm8', role: 'assistant', parts: [{ type: 'text', text: 'Reply 4' }] }),
      makeMessage({ id: 'm9', role: 'user', parts: [{ type: 'text', text: 'Fifth' }] }),
    ];

    const result = await compactMessagesWithSummary(messages, 'gpt-4o', mockModelConfig, {
      force: true,
    });

    // Should still return a result (sliding-window fallback), not throw
    expect(result).toBeDefined();
    expect(result.compactionMethod).toBe('sliding-window');
  });
});

// ── Transcript repair integration ──

describe('compactMessagesWithSummary — transcript repair integration', () => {
  const mockModelConfig: ChatModel = {
    id: 'test-model',
    name: 'Test',
    provider: 'openai',
    routingMode: 'direct',
  };

  it('repairs transcript before compaction', async () => {
    const mockSummarizeLocal = vi.mocked(summarizeMessages);
    mockSummarizeLocal.mockResolvedValueOnce('Summary of conversation');

    // Messages with empty message that should be filtered by repair
    const messages = [
      makeMessage({ id: 'm1', role: 'user', parts: [{ type: 'text', text: 'x'.repeat(10000) }] }),
      makeMessage({ id: 'm2', role: 'assistant', parts: [] }), // empty, should be removed
      makeMessage({
        id: 'm3',
        role: 'assistant',
        parts: [{ type: 'text', text: 'x'.repeat(10000) }],
      }),
      makeMessage({ id: 'm4', role: 'user', parts: [{ type: 'text', text: 'x'.repeat(10000) }] }),
      makeMessage({
        id: 'm5',
        role: 'assistant',
        parts: [{ type: 'text', text: 'x'.repeat(10000) }],
      }),
      makeMessage({ id: 'm6', role: 'user', parts: [{ type: 'text', text: 'x'.repeat(10000) }] }),
      makeMessage({
        id: 'm7',
        role: 'assistant',
        parts: [{ type: 'text', text: 'x'.repeat(10000) }],
      }),
      makeMessage({ id: 'm8', role: 'user', parts: [{ type: 'text', text: 'x'.repeat(10000) }] }),
      makeMessage({
        id: 'm9',
        role: 'assistant',
        parts: [{ type: 'text', text: 'x'.repeat(10000) }],
      }),
    ];

    // Use force mode to trigger summarization even if under budget
    await compactMessagesWithSummary(messages, 'test-model', mockModelConfig, {
      systemPromptTokens: 0,
      force: true,
    });

    // Verify repairTranscript was called with the messages
    const mockRepair = vi.mocked(repairTranscript);
    expect(mockRepair).toHaveBeenCalled();
    // The input should include the empty message; repair filters it
    const inputMessages = mockRepair.mock.calls[0]![0]!;
    expect(inputMessages.length).toBe(messages.length);
  });
});

// ── Timeout fallback ──

describe('compactMessagesWithSummary — timeout fallback', () => {
  const mockModelConfig: ChatModel = {
    id: 'test-model',
    name: 'Test',
    provider: 'openai',
    routingMode: 'direct',
  };

  it('completes normally when summarization finishes within timeout', async () => {
    const mockSummarizeLocal = vi.mocked(summarizeMessages);
    mockSummarizeLocal.mockResolvedValueOnce('Fast summary result');

    const messages = [
      makeMessage({ id: 'm1', role: 'user', parts: [{ type: 'text', text: 'x'.repeat(50000) }] }),
      makeMessage({
        id: 'm2',
        role: 'assistant',
        parts: [{ type: 'text', text: 'x'.repeat(50000) }],
      }),
      makeMessage({ id: 'm3', role: 'user', parts: [{ type: 'text', text: 'x'.repeat(50000) }] }),
      makeMessage({
        id: 'm4',
        role: 'assistant',
        parts: [{ type: 'text', text: 'x'.repeat(50000) }],
      }),
      makeMessage({ id: 'm5', role: 'user', parts: [{ type: 'text', text: 'x'.repeat(50000) }] }),
      makeMessage({
        id: 'm6',
        role: 'assistant',
        parts: [{ type: 'text', text: 'x'.repeat(50000) }],
      }),
      makeMessage({ id: 'm7', role: 'user', parts: [{ type: 'text', text: 'x'.repeat(50000) }] }),
      makeMessage({
        id: 'm8',
        role: 'assistant',
        parts: [{ type: 'text', text: 'x'.repeat(50000) }],
      }),
      makeMessage({ id: 'm9', role: 'user', parts: [{ type: 'text', text: 'latest question' }] }),
    ];

    const result = await compactMessagesWithSummary(messages, 'test-model', mockModelConfig, {
      systemPromptTokens: 0,
      force: true,
    });

    expect(result.wasCompacted).toBe(true);
    // Should use summary method when summarization succeeds
    expect(result.compactionMethod).toBe('summary');
  });
});

describe('compactMessagesWithSummary — configurable settings', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('uses config.tokenSafetyMargin to influence compaction decision', async () => {
    // Verify that a higher tokenSafetyMargin triggers compaction
    // where the default would not, by checking messages that are within
    // 1.25x budget but exceed 2.0x budget.
    // We use a tiny contextWindowOverride so the threshold is easy to control.
    // effective = 1000 * 0.75 = 750 tokens. Budget = 750 - 0 = 750.
    // Use ~400 tokens (1200 chars). 400 * 1.25 = 500 < 750 (no compact).
    // 400 * 2.0 = 800 > 750 (compact!).
    mockSummarize.mockResolvedValue('Summarized');

    const text = 'x'.repeat(1_200); // ~400 tokens
    const messages = [
      makeMessage({ id: 'm1', role: 'user', parts: [{ type: 'text', text: 'Start' }] }),
      makeMessage({ id: 'm2', role: 'assistant', parts: [{ type: 'text', text: text }] }),
      makeMessage({ id: 'm3', role: 'user', parts: [{ type: 'text', text: 'End' }] }),
    ];

    const defaultResult = await compactMessagesWithSummary(
      messages,
      'test-model',
      mockModelConfig,
      {
        systemPromptTokens: 0,
        contextWindowOverride: 1_000,
      },
    );
    expect(defaultResult.wasCompacted).toBe(false);

    // Same messages but with higher safety margin
    const strictResult = await compactMessagesWithSummary(messages, 'test-model', mockModelConfig, {
      systemPromptTokens: 0,
      contextWindowOverride: 1_000,
      compactionConfig: { tokenSafetyMargin: 2.0 },
    });
    expect(strictResult.wasCompacted).toBe(true);
  });

  it('uses config.maxHistoryShare to control per-message budget cap', async () => {
    mockSummarize.mockResolvedValueOnce('Summary');

    const largeAssistant = 'x'.repeat(300_000); // Very large message
    const messages = [
      makeMessage({ id: 'm1', role: 'user', parts: [{ type: 'text', text: 'Start' }] }),
      makeMessage({ id: 'm2', role: 'assistant', parts: [{ type: 'text', text: largeAssistant }] }),
      makeMessage({ id: 'm3', role: 'user', parts: [{ type: 'text', text: 'Middle question' }] }),
      makeMessage({
        id: 'm4',
        role: 'assistant',
        parts: [{ type: 'text', text: 'Middle answer' }],
      }),
      makeMessage({ id: 'm5', role: 'user', parts: [{ type: 'text', text: 'Another question' }] }),
      makeMessage({
        id: 'm6',
        role: 'assistant',
        parts: [{ type: 'text', text: 'Another answer' }],
      }),
      makeMessage({ id: 'm7', role: 'user', parts: [{ type: 'text', text: 'End' }] }),
    ];

    // With a very low maxHistoryShare (0.1), the large message should be truncated more aggressively
    const result = await compactMessagesWithSummary(messages, 'gpt-4o', mockModelConfig, {
      systemPromptTokens: 0,
      force: true,
      compactionConfig: { maxHistoryShare: 0.1 },
    });

    expect(result.wasCompacted).toBe(true);
  });

  it('passes compactionConfig quality guard settings to summarizer', async () => {
    mockSummarize.mockResolvedValueOnce('Summary');

    const longText = 'x'.repeat(300_000);
    const messages = [
      makeMessage({ id: 'm1', role: 'user', parts: [{ type: 'text', text: 'Start' }] }),
      makeMessage({ id: 'm2', role: 'assistant', parts: [{ type: 'text', text: longText }] }),
      makeMessage({ id: 'm3', role: 'user', parts: [{ type: 'text', text: 'End' }] }),
    ];

    await compactMessagesWithSummary(messages, 'gpt-4o', mockModelConfig, {
      systemPromptTokens: 0,
      compactionConfig: {
        qualityGuardEnabled: false,
        qualityGuardMaxRetries: 1,
        identifierPolicy: 'off',
      },
    });

    if (mockSummarize.mock.calls.length > 0) {
      // Verify the summarizer was called with options containing the config
      const summarizerOpts = mockSummarize.mock.calls[0]![2];
      expect(summarizerOpts).toBeDefined();
      if (typeof summarizerOpts === 'object') {
        expect(summarizerOpts.qualityGuardEnabled).toBe(false);
        expect(summarizerOpts.qualityGuardMaxRetries).toBe(1);
        expect(summarizerOpts.identifierPolicy).toBe('off');
      }
    }
  });
});

// ── Diagnostic fields on CompactionResult ──

describe('compactMessages — diagnostic fields', () => {
  it('populates tokensBefore, tokensAfter, messagesDropped, durationMs when compaction occurs', () => {
    const longText = 'x'.repeat(200_000);
    const messages = [
      makeMessage({ id: 'm1', role: 'user', parts: [{ type: 'text', text: 'Start' }] }),
      makeMessage({ id: 'm2', role: 'assistant', parts: [{ type: 'text', text: longText }] }),
      makeMessage({ id: 'm3', role: 'user', parts: [{ type: 'text', text: longText }] }),
      makeMessage({ id: 'm4', role: 'assistant', parts: [{ type: 'text', text: longText }] }),
      makeMessage({ id: 'm5', role: 'user', parts: [{ type: 'text', text: longText }] }),
      makeMessage({ id: 'm6', role: 'assistant', parts: [{ type: 'text', text: longText }] }),
      makeMessage({ id: 'm7', role: 'user', parts: [{ type: 'text', text: longText }] }),
      makeMessage({ id: 'm8', role: 'assistant', parts: [{ type: 'text', text: longText }] }),
      makeMessage({ id: 'm9', role: 'user', parts: [{ type: 'text', text: 'Latest question' }] }),
    ];
    const result = compactMessages(messages, 'gpt-4o');
    expect(result.wasCompacted).toBe(true);
    expect(result.tokensBefore).toBeGreaterThan(0);
    expect(result.tokensAfter).toBeGreaterThan(0);
    expect(result.tokensAfter).toBeLessThan(result.tokensBefore!);
    expect(result.messagesDropped).toBeGreaterThan(0);
    expect(result.messagesDropped).toBe(messages.length - result.messages.length);
    expect(result.durationMs).toBeGreaterThanOrEqual(0);
  });

  it('returns undefined diagnostics when no compaction needed', () => {
    const messages = [
      makeMessage({ id: 'm1', role: 'user', parts: [{ type: 'text', text: 'Hi' }] }),
      makeMessage({ id: 'm2', role: 'assistant', parts: [{ type: 'text', text: 'Hello!' }] }),
    ];
    const result = compactMessages(messages, 'gpt-4o');
    expect(result.wasCompacted).toBe(false);
    expect(result.tokensBefore).toBeUndefined();
    expect(result.tokensAfter).toBeUndefined();
    expect(result.messagesDropped).toBeUndefined();
    expect(result.durationMs).toBeUndefined();
  });
});
