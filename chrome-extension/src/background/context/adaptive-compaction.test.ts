import {
  shouldUseAdaptiveCompaction,
  computePartCount,
  splitMessagesByTokenShare,
} from './adaptive-compaction';
import { getModelContextLimit } from './limits';
import { describe, it, expect, vi } from 'vitest';
import type { ChatMessage } from '@extension/shared';

vi.mock('./limits', () => ({
  getModelContextLimit: vi.fn(() => 128_000),
  getEffectiveContextLimit: vi.fn(() => 96_000),
}));

const makeMessage = (textLength: number): ChatMessage => ({
  id: 'msg-' + Math.random().toString(36).slice(2, 8),
  chatId: 'chat-1',
  role: 'user',
  parts: [{ type: 'text', text: 'x'.repeat(textLength) }],
  createdAt: Date.now(),
});

describe('shouldUseAdaptiveCompaction', () => {
  it('returns false when within context window', () => {
    // 128k context, messages need to exceed 128k * 1.2 = 153,600 tokens
    // Each char is ~0.25 tokens, so 153,600 tokens = ~614,400 chars
    const messages = [makeMessage(1000)]; // ~250 tokens
    expect(shouldUseAdaptiveCompaction(messages, 'gpt-4o')).toBe(false);
  });

  it('returns true when exceeding 1.2x context window', () => {
    vi.mocked(getModelContextLimit).mockReturnValue(100);
    // 100 * 1.2 = 120 threshold
    // Make messages that total > 120 tokens
    // Each message: textLength/4 + 4 overhead
    // Need >120 tokens. 500 chars = 125 tokens + 4 = 129 tokens
    const messages = [makeMessage(500)];
    expect(shouldUseAdaptiveCompaction(messages, 'test-model')).toBe(true);
  });

  it('returns false at exactly threshold', () => {
    vi.mocked(getModelContextLimit).mockReturnValue(1000);
    // 1000 * 1.2 = 1200 threshold
    // Need exactly 1200 tokens: 1200 tokens = (chars/4 + 4)
    // chars/4 = 1196, chars = 4784
    const messages = [makeMessage(4780)]; // ~1199 tokens
    expect(shouldUseAdaptiveCompaction(messages, 'test-model')).toBe(false);
  });
});

describe('computePartCount', () => {
  it('returns minimum of 2', () => {
    vi.mocked(getModelContextLimit).mockReturnValue(100);
    const messages = [makeMessage(500)]; // modest overflow
    const parts = computePartCount(messages, 'test');
    expect(parts).toBeGreaterThanOrEqual(2);
  });

  it('returns maximum of 8', () => {
    vi.mocked(getModelContextLimit).mockReturnValue(100);
    // Massive overflow — many messages
    const messages = Array.from({ length: 100 }, () => makeMessage(5000));
    const parts = computePartCount(messages, 'test');
    expect(parts).toBeLessThanOrEqual(8);
  });

  it('increases parts with overflow', () => {
    vi.mocked(getModelContextLimit).mockReturnValue(1000);
    const small = [makeMessage(6000)]; // ~1500 tokens, 1.5x overflow
    const large = [makeMessage(20000)]; // ~5000 tokens, 5x overflow

    const smallParts = computePartCount(small, 'test');
    const largeParts = computePartCount(large, 'test');

    expect(largeParts).toBeGreaterThanOrEqual(smallParts);
  });
});

describe('splitMessagesByTokenShare', () => {
  it('returns single part for parts=1', () => {
    const messages = [makeMessage(100), makeMessage(200)];
    const result = splitMessagesByTokenShare(messages, 1);
    expect(result).toHaveLength(1);
    expect(result[0]).toEqual(messages);
  });

  it('returns empty for empty messages', () => {
    const result = splitMessagesByTokenShare([], 3);
    expect(result).toHaveLength(0);
  });

  it('splits into requested number of parts', () => {
    const messages = Array.from({ length: 12 }, () => makeMessage(100));
    const result = splitMessagesByTokenShare(messages, 3);

    // Should have at most 3 parts
    expect(result.length).toBeLessThanOrEqual(3);
    expect(result.length).toBeGreaterThan(0);

    // All messages should be present
    const flattened = result.flat();
    expect(flattened.length).toBe(12);
  });

  it('keeps messages intact (no splitting across parts)', () => {
    const messages = [makeMessage(100), makeMessage(200), makeMessage(300)];
    const result = splitMessagesByTokenShare(messages, 2);

    // Each part should contain complete messages
    const allMessages = result.flat();
    for (const msg of messages) {
      expect(allMessages).toContain(msg);
    }
  });

  it('handles more parts than messages', () => {
    const messages = [makeMessage(100)];
    const result = splitMessagesByTokenShare(messages, 5);

    // Can't have more parts than messages
    expect(result.length).toBe(1);
    expect(result[0]!.length).toBe(1);
  });

  it('distributes roughly evenly by token count', () => {
    // 6 equal-sized messages split into 3 parts → ~2 per part
    const messages = Array.from({ length: 6 }, () => makeMessage(400));
    const result = splitMessagesByTokenShare(messages, 3);

    expect(result.length).toBe(3);
    // Each part should have roughly 2 messages
    for (const part of result) {
      expect(part.length).toBeGreaterThanOrEqual(1);
      expect(part.length).toBeLessThanOrEqual(4);
    }
  });
});
