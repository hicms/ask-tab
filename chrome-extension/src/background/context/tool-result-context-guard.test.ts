import { COMPACTION_PLACEHOLDER, enforceToolResultBudget } from './tool-result-context-guard';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { ChatMessage } from '@extension/shared';

// Mock limits
vi.mock('./limits', () => ({
  getEffectiveContextLimit: vi.fn(() => 128_000), // 128K tokens
  getModelContextLimit: vi.fn(() => 128_000),
}));

// Mock tool-result-truncation to just slice
vi.mock('./tool-result-truncation', () => ({
  truncateToolResultText: vi.fn((text: string, maxChars: number) =>
    text.length > maxChars ? text.slice(0, maxChars) + '... [truncated]' : text,
  ),
}));

const makeMessage = (overrides: Partial<ChatMessage> = {}): ChatMessage => ({
  id: 'msg-1',
  chatId: 'chat-1',
  role: 'user',
  parts: [{ type: 'text', text: 'Hello' }],
  createdAt: Date.now(),
  ...overrides,
});

beforeEach(() => {
  vi.clearAllMocks();
});

describe('enforceToolResultBudget — per-result cap', () => {
  it('truncates a tool-result exceeding 50% of context window', () => {
    // 128K context * 0.5 * 3 chars = 192K char limit per result
    const hugeResult = 'x'.repeat(300_000);
    const messages = [
      makeMessage({
        role: 'assistant',
        parts: [{ type: 'tool-result', toolCallId: 'tc-1', toolName: 'test', result: hugeResult }],
      }),
    ];
    const result = enforceToolResultBudget(messages, 'gpt-4o');
    const part = result[0]!.parts[0]! as Extract<
      ChatMessage['parts'][number],
      { type: 'tool-result' }
    >;
    expect((part.result as string).length).toBeLessThan(hugeResult.length);
  });

  it('leaves small tool-results unchanged', () => {
    const messages = [
      makeMessage({
        role: 'assistant',
        parts: [{ type: 'tool-result', toolCallId: 'tc-1', toolName: 'test', result: 'small' }],
      }),
    ];
    const result = enforceToolResultBudget(messages, 'gpt-4o');
    expect(
      (result[0]!.parts[0] as Extract<ChatMessage['parts'][number], { type: 'tool-result' }>)
        .result,
    ).toBe('small');
  });

  it('truncates multiple oversized results independently', () => {
    const huge = 'x'.repeat(300_000);
    const messages = [
      makeMessage({
        role: 'assistant',
        parts: [
          { type: 'tool-result', toolCallId: 'tc-1', toolName: 'a', result: huge },
          { type: 'tool-result', toolCallId: 'tc-2', toolName: 'b', result: huge },
        ],
      }),
    ];
    const result = enforceToolResultBudget(messages, 'gpt-4o');
    expect(
      (
        (result[0]!.parts[0] as Extract<ChatMessage['parts'][number], { type: 'tool-result' }>)
          .result as string
      ).length,
    ).toBeLessThan(huge.length);
    expect(
      (
        (result[0]!.parts[1] as Extract<ChatMessage['parts'][number], { type: 'tool-result' }>)
          .result as string
      ).length,
    ).toBeLessThan(huge.length);
  });

  it('preserves non-tool-result parts', () => {
    const messages = [
      makeMessage({
        role: 'assistant',
        parts: [
          { type: 'text', text: 'some text' },
          {
            type: 'tool-result',
            toolCallId: 'tc-1',
            toolName: 'test',
            result: 'x'.repeat(300_000),
          },
        ],
      }),
    ];
    const result = enforceToolResultBudget(messages, 'gpt-4o');
    expect(
      (result[0]!.parts[0] as Extract<ChatMessage['parts'][number], { type: 'text' }>).text,
    ).toBe('some text');
  });
});

describe('enforceToolResultBudget — global cap', () => {
  it('replaces oldest tool-results when total exceeds 75% context', () => {
    // 128K * 0.75 * 3 = 288K char global limit
    // Each result = 100K chars, 5 results = 500K > 288K
    const largeResult = 'x'.repeat(100_000);
    const messages = Array.from({ length: 5 }, (_, i) =>
      makeMessage({
        id: `msg-${i}`,
        role: 'assistant',
        parts: [
          {
            type: 'tool-result',
            toolCallId: `tc-${i}`,
            toolName: 'test',
            result: largeResult,
          },
        ],
      }),
    );
    const result = enforceToolResultBudget(messages, 'gpt-4o');
    // Oldest messages should have placeholder
    const firstResult = (
      result[0]!.parts[0] as Extract<ChatMessage['parts'][number], { type: 'tool-result' }>
    ).result;
    expect(firstResult).toBe(COMPACTION_PLACEHOLDER);
    // Latest should still have content (not placeholder)
    const lastResult = (
      result[4]!.parts[0] as Extract<ChatMessage['parts'][number], { type: 'tool-result' }>
    ).result;
    expect(lastResult).not.toBe(COMPACTION_PLACEHOLDER);
  });

  it('stops replacing once under budget', () => {
    const largeResult = 'x'.repeat(100_000);
    const messages = [
      makeMessage({
        id: 'm1',
        role: 'assistant',
        parts: [{ type: 'tool-result', toolCallId: 'tc-1', toolName: 'a', result: largeResult }],
      }),
      makeMessage({
        id: 'm2',
        role: 'assistant',
        parts: [{ type: 'tool-result', toolCallId: 'tc-2', toolName: 'b', result: largeResult }],
      }),
      makeMessage({
        id: 'm3',
        role: 'assistant',
        parts: [{ type: 'tool-result', toolCallId: 'tc-3', toolName: 'c', result: largeResult }],
      }),
    ];
    const result = enforceToolResultBudget(messages, 'gpt-4o');
    // Some should be replaced, some should remain
    const placeholderCount = result.filter(m =>
      m.parts.some(p => p.type === 'tool-result' && p.result === COMPACTION_PLACEHOLDER),
    ).length;
    const contentCount = result.filter(m =>
      m.parts.some(p => p.type === 'tool-result' && p.result !== COMPACTION_PLACEHOLDER),
    ).length;
    expect(placeholderCount).toBeGreaterThan(0);
    expect(contentCount).toBeGreaterThan(0);
  });
});

describe('enforceToolResultBudget — immutability', () => {
  it('does not mutate input messages', () => {
    const original = [
      makeMessage({
        role: 'assistant',
        parts: [
          {
            type: 'tool-result',
            toolCallId: 'tc-1',
            toolName: 'test',
            result: 'x'.repeat(300_000),
          },
        ],
      }),
    ];
    const originalResult = (
      original[0]!.parts[0] as Extract<ChatMessage['parts'][number], { type: 'tool-result' }>
    ).result;
    enforceToolResultBudget(original, 'gpt-4o');
    expect(
      (original[0]!.parts[0] as Extract<ChatMessage['parts'][number], { type: 'tool-result' }>)
        .result,
    ).toBe(originalResult);
  });

  it('returns new array', () => {
    const messages = [makeMessage()];
    const result = enforceToolResultBudget(messages, 'gpt-4o');
    expect(result).not.toBe(messages);
  });
});

describe('enforceToolResultBudget — edge cases', () => {
  it('handles messages with no tool-results', () => {
    const messages = [makeMessage({ parts: [{ type: 'text', text: 'hello' }] })];
    const result = enforceToolResultBudget(messages, 'gpt-4o');
    expect(result).toHaveLength(1);
    expect(
      (result[0]!.parts[0] as Extract<ChatMessage['parts'][number], { type: 'text' }>).text,
    ).toBe('hello');
  });

  it('handles empty messages array', () => {
    expect(enforceToolResultBudget([], 'gpt-4o')).toEqual([]);
  });
});
