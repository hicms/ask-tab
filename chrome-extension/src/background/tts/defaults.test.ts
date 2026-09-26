import {
  DEFAULT_MODEL,
  DEFAULT_VOICE,
  DEFAULT_SPEED,
  DEFAULT_MAX_CHARS,
  MIN_TTS_LENGTH,
  DEFAULT_SYNTHESIS_TIMEOUT_MS,
} from './defaults';
import { describe, it, expect } from 'vitest';

describe('tts/defaults', () => {
  it('exports DEFAULT_MODEL as Kokoro ONNX model', () => {
    expect(DEFAULT_MODEL).toBe('onnx-community/Kokoro-82M-v1.0-ONNX');
  });

  it('exports DEFAULT_VOICE', () => {
    expect(DEFAULT_VOICE).toBe('af_heart');
  });

  it('exports DEFAULT_SPEED as 1.0', () => {
    expect(DEFAULT_SPEED).toBe(1.0);
  });

  it('exports DEFAULT_MAX_CHARS as a reasonable number', () => {
    expect(DEFAULT_MAX_CHARS).toBeGreaterThanOrEqual(100);
    expect(DEFAULT_MAX_CHARS).toBeLessThanOrEqual(10000);
  });

  it('exports MIN_TTS_LENGTH', () => {
    expect(MIN_TTS_LENGTH).toBe(10);
  });

  it('exports DEFAULT_SYNTHESIS_TIMEOUT_MS', () => {
    expect(DEFAULT_SYNTHESIS_TIMEOUT_MS).toBeGreaterThan(0);
  });
});
