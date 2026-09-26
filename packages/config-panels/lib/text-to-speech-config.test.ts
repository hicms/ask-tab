import { defaultTtsConfig } from '@extension/storage';
import { describe, expect, it } from 'vitest';

describe('TextToSpeechConfig — defaults', () => {
  it('defaultTtsConfig has expected shape', () => {
    expect(defaultTtsConfig.engine).toBe('off');
    expect(defaultTtsConfig.autoMode).toBe('always');
    expect(defaultTtsConfig.maxChars).toBe(4000);
    expect(defaultTtsConfig.summarize).toBe(true);
    expect(defaultTtsConfig.summaryTimeout).toBe(15000);
    expect(defaultTtsConfig.chatUiAutoPlay).toBe(false);
    expect(defaultTtsConfig.openai.modelId).toBe('');
    expect(defaultTtsConfig.openai.voice).toBe('nova');
  });
});
