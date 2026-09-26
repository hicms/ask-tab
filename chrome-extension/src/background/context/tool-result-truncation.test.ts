import {
  calculateMaxToolResultChars,
  truncateToolResultText,
  truncateToolResults,
  hasOversizedToolResults,
  stripBase64FromText,
  MAX_TOOL_RESULT_CONTEXT_SHARE,
  MIN_KEEP_CHARS,
  CHARS_PER_TOKEN,
} from './tool-result-truncation';
import { describe, it, expect, vi } from 'vitest';
import type { AgentMessage } from '../agents';

// Mock getModelContextLimit
vi.mock('@extension/shared', () => ({
  getModelContextLimit: vi.fn((modelId: string) => {
    if (modelId === 'gpt-4o') return 128_000;
    if (modelId === 'small-model') return 4096;
    return 8192; // default
  }),
}));

describe('tool-result-truncation', () => {
  describe('calculateMaxToolResultChars', () => {
    it('calculates 30% of context window * 4 chars/token', () => {
      const result = calculateMaxToolResultChars('gpt-4o');
      // 128000 * 0.3 * 4 = 153600
      expect(result).toBe(Math.floor(128_000 * MAX_TOOL_RESULT_CONTEXT_SHARE * CHARS_PER_TOKEN));
    });

    it('returns at least MIN_KEEP_CHARS', () => {
      const result = calculateMaxToolResultChars('small-model');
      // 4096 * 0.3 * 4 = 4915.2 → 4915 — above MIN_KEEP_CHARS
      expect(result).toBeGreaterThanOrEqual(MIN_KEEP_CHARS);
    });
  });

  describe('truncateToolResultText', () => {
    it('returns text unchanged if within limit', () => {
      const text = 'short text';
      expect(truncateToolResultText(text, 100)).toBe(text);
    });

    it('truncates text exceeding limit', () => {
      const text = 'a'.repeat(5000);
      const result = truncateToolResultText(text, 3000);
      expect(result.length).toBeLessThan(text.length);
      expect(result).toContain('[... truncated');
    });

    it('cuts at nearest preceding newline for clean truncation', () => {
      const lines = Array.from({ length: 100 }, (_, i) => `Line ${i}: ${'x'.repeat(50)}`);
      const text = lines.join('\n');
      const result = truncateToolResultText(text, 3000);
      // Should end at a newline boundary (before the truncation notice)
      const beforeNotice = result.split('\n\n[... truncated')[0];
      expect(beforeNotice.endsWith('\n')).toBe(false); // last line doesn't end with \n
      expect(text.includes(beforeNotice)).toBe(true); // kept text is a prefix of original
    });

    it('includes truncated character count in notice', () => {
      const text = 'a'.repeat(10000);
      const result = truncateToolResultText(text, 3000);
      expect(result).toMatch(/truncated \d+ characters/);
    });
  });

  describe('truncateToolResults', () => {
    const makeToolResultMessage = (text: string): AgentMessage => ({
      role: 'toolResult',
      toolCallId: 'tc-1',
      toolName: 'test-tool',
      content: [{ type: 'text', text }],
      isError: false,
      timestamp: Date.now(),
    });

    const makeUserMessage = (text: string): AgentMessage => ({
      role: 'user',
      content: [{ type: 'text', text }],
      timestamp: Date.now(),
    });

    it('returns messages unchanged if no tool results exceed limit', () => {
      const messages: AgentMessage[] = [
        makeUserMessage('hello'),
        makeToolResultMessage('short result'),
      ];
      const { messages: result, truncatedCount } = truncateToolResults(messages, 'gpt-4o');
      expect(truncatedCount).toBe(0);
      expect(result).toEqual(messages);
    });

    it('truncates oversized tool results', () => {
      const maxChars = calculateMaxToolResultChars('gpt-4o');
      const bigText = 'x'.repeat(maxChars + 10000);
      const messages: AgentMessage[] = [makeUserMessage('hello'), makeToolResultMessage(bigText)];
      const { messages: result, truncatedCount } = truncateToolResults(messages, 'gpt-4o');
      expect(truncatedCount).toBe(1);
      const toolResult = result[1] as { content: Array<{ type: string; text: string }> };
      expect(toolResult.content[0].text.length).toBeLessThan(bigText.length);
    });

    it('does not mutate the original messages', () => {
      const maxChars = calculateMaxToolResultChars('gpt-4o');
      const bigText = 'x'.repeat(maxChars + 5000);
      const original = makeToolResultMessage(bigText);
      const messages: AgentMessage[] = [original];
      truncateToolResults(messages, 'gpt-4o');
      // Original should still have the full text
      const originalContent = (original as { content: Array<{ text: string }> }).content[0];
      expect(originalContent.text).toBe(bigText);
    });

    it('preserves non-tool-result messages', () => {
      const messages: AgentMessage[] = [
        makeUserMessage('hello world'),
        makeToolResultMessage('result'),
      ];
      const { messages: result } = truncateToolResults(messages, 'gpt-4o');
      expect(result[0]).toBe(messages[0]); // same reference
    });
  });

  describe('hasOversizedToolResults', () => {
    it('returns false when no tool results', () => {
      const messages: AgentMessage[] = [
        { role: 'user', content: [{ type: 'text', text: 'hi' }], timestamp: Date.now() },
      ];
      expect(hasOversizedToolResults(messages, 'gpt-4o')).toBe(false);
    });

    it('returns false when tool results are within limits', () => {
      const messages: AgentMessage[] = [
        {
          role: 'toolResult',
          toolCallId: 'tc-1',
          toolName: 'test',
          content: [{ type: 'text', text: 'small result' }],
          isError: false,
          timestamp: Date.now(),
        } as AgentMessage,
      ];
      expect(hasOversizedToolResults(messages, 'gpt-4o')).toBe(false);
    });

    it('returns true when a tool result exceeds the limit', () => {
      const maxChars = calculateMaxToolResultChars('gpt-4o');
      const messages: AgentMessage[] = [
        {
          role: 'toolResult',
          toolCallId: 'tc-1',
          toolName: 'test',
          content: [{ type: 'text', text: 'x'.repeat(maxChars + 1) }],
          isError: false,
          timestamp: Date.now(),
        } as AgentMessage,
      ];
      expect(hasOversizedToolResults(messages, 'gpt-4o')).toBe(true);
    });
  });

  describe('stripBase64FromText', () => {
    it('strips JSON-wrapped base64 image data', () => {
      const base64 = 'A'.repeat(2000);
      const text = `{"base64":"${base64}","mimeType":"image/png"}`;
      const result = stripBase64FromText(text);
      expect(result).toContain('[image data removed]');
      expect(result).not.toContain(base64);
      expect(result.length).toBeLessThan(text.length);
    });

    it('strips data URL base64 content', () => {
      const base64 = 'A'.repeat(2000);
      const text = `Here is an image: data:image/png;base64,${base64} and some text`;
      const result = stripBase64FromText(text);
      expect(result).toContain('[image data removed]');
      expect(result).not.toContain(base64);
      expect(result).toContain('and some text');
    });

    it('leaves text without base64 unchanged', () => {
      const text = 'Just a normal tool result with no images';
      expect(stripBase64FromText(text)).toBe(text);
    });

    it('ignores short base64-like strings (< 1000 chars)', () => {
      const text = '{"base64":"shortString","mimeType":"image/png"}';
      expect(stripBase64FromText(text)).toBe(text);
    });

    it('handles multiple base64 occurrences', () => {
      const b1 = 'A'.repeat(1500);
      const b2 = 'B'.repeat(1500);
      const text = `{"base64":"${b1}"},{"data":"${b2}"}`;
      const result = stripBase64FromText(text);
      expect(result).not.toContain(b1);
      expect(result).not.toContain(b2);
    });
  });

  describe('contextLimitOverride', () => {
    it('calculateMaxToolResultChars uses override when provided', () => {
      const withDefault = calculateMaxToolResultChars('gpt-4o');
      const withOverride = calculateMaxToolResultChars('gpt-4o', 32000);
      // 32000 * 0.3 * 4 = 38400, which is less than the default gpt-4o limit
      expect(withOverride).toBe(
        Math.floor(32000 * MAX_TOOL_RESULT_CONTEXT_SHARE * CHARS_PER_TOKEN),
      );
      expect(withOverride).toBeLessThan(withDefault);
    });

    it('hasOversizedToolResults uses override for smaller limits', () => {
      // Create a result that fits within gpt-4o's limit but exceeds a 4096 override
      const overrideChars = calculateMaxToolResultChars('gpt-4o', 4096);
      const bigText = 'x'.repeat(overrideChars + 100);
      const messages: AgentMessage[] = [
        {
          role: 'toolResult',
          toolCallId: 'tc-1',
          toolName: 'test',
          content: [{ type: 'text', text: bigText }],
          isError: false,
          timestamp: Date.now(),
        } as AgentMessage,
      ];
      // Without override: fits fine
      expect(hasOversizedToolResults(messages, 'gpt-4o')).toBe(false);
      // With small override: oversized
      expect(hasOversizedToolResults(messages, 'gpt-4o', 4096)).toBe(true);
    });

    it('truncateToolResults uses override', () => {
      const overrideChars = calculateMaxToolResultChars('gpt-4o', 4096);
      const bigText = 'x'.repeat(overrideChars + 5000);
      const messages: AgentMessage[] = [
        {
          role: 'toolResult',
          toolCallId: 'tc-1',
          toolName: 'test',
          content: [{ type: 'text', text: bigText }],
          isError: false,
          timestamp: Date.now(),
        } as AgentMessage,
      ];
      const { truncatedCount } = truncateToolResults(messages, 'gpt-4o', 4096);
      expect(truncatedCount).toBe(1);
    });
  });

  describe('truncateToolResultText — base64 stripping', () => {
    it('strips base64 before truncating, potentially avoiding truncation', () => {
      // Create text with a large base64 blob that makes it oversized
      const base64 = 'A'.repeat(200_000);
      const text = `Screenshot result: {"base64":"${base64}","mimeType":"image/png"}`;
      // With base64: ~200K chars. Without: ~70 chars. Limit: 100K.
      const result = truncateToolResultText(text, 100_000);
      // After stripping, text should be small enough to not need truncation
      expect(result).not.toContain('[... truncated');
      expect(result).toContain('[image data removed]');
    });
  });
});
