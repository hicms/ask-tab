import { summarizeForTts, TTS_SUMMARY_PROMPT } from './summarize';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { ChatModel } from '@extension/shared';

// Mock completeText from pi-stream-bridge
const mockCompleteText = vi.fn();
vi.mock('../agents/stream-bridge', () => ({
  completeText: (...args: unknown[]) => mockCompleteText(...args),
}));

const mockModel: ChatModel = {
  id: 'test-model',
  name: 'Test Model',
  provider: 'custom',
};

describe('tts/summarize', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('truncates when no modelConfig is provided', async () => {
    const text = 'A'.repeat(100);
    const result = await summarizeForTts(text, 50);
    expect(result).toBe('A'.repeat(47) + '...');
    expect(result.length).toBe(50);
  });

  it('calls completeText with correct params', async () => {
    mockCompleteText.mockResolvedValue('Summary of the text.');

    const result = await summarizeForTts('Long text here', 500, mockModel);

    expect(mockCompleteText).toHaveBeenCalledWith(
      mockModel,
      TTS_SUMMARY_PROMPT,
      'Long text here',
      expect.objectContaining({ maxTokens: expect.any(Number) }),
    );
    expect(result).toBe('Summary of the text.');
  });

  it('truncates summary if it exceeds maxChars', async () => {
    mockCompleteText.mockResolvedValue('X'.repeat(600));

    const result = await summarizeForTts('Long text', 500, mockModel);
    expect(result.length).toBe(500);
    expect(result.endsWith('...')).toBe(true);
  });

  it('falls back to truncation on empty summary', async () => {
    mockCompleteText.mockResolvedValue('');

    const result = await summarizeForTts('A'.repeat(100), 50, mockModel);
    expect(result).toBe('A'.repeat(47) + '...');
  });

  it('propagates errors for caller to catch', async () => {
    mockCompleteText.mockRejectedValue(new Error('API error'));

    await expect(summarizeForTts('Text', 500, mockModel)).rejects.toThrow('API error');
  });

  it('exports the summary prompt constant', () => {
    expect(TTS_SUMMARY_PROMPT).toContain('Summarize');
  });
});
