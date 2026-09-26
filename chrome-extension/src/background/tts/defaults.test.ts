import { DEFAULT_MAX_CHARS, MIN_TTS_LENGTH } from './defaults';
import { describe, it, expect } from 'vitest';

describe('tts/defaults', () => {
  it('exports DEFAULT_MAX_CHARS as a reasonable number', () => {
    expect(DEFAULT_MAX_CHARS).toBeGreaterThanOrEqual(100);
    expect(DEFAULT_MAX_CHARS).toBeLessThanOrEqual(10000);
  });

  it('exports MIN_TTS_LENGTH', () => {
    expect(MIN_TTS_LENGTH).toBe(10);
  });
});
