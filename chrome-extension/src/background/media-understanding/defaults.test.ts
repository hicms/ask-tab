/**
 * Tests for media-understanding/defaults.ts
 */
import { DEFAULT_LOCAL_MODEL, DEFAULT_TRANSCRIPTION_TIMEOUT_MS } from './defaults';
import { describe, it, expect } from 'vitest';

describe('STT defaults', () => {
  it('DEFAULT_LOCAL_MODEL is "tiny"', () => {
    expect(DEFAULT_LOCAL_MODEL).toBe('tiny');
  });

  it('DEFAULT_TRANSCRIPTION_TIMEOUT_MS is 5 minutes', () => {
    expect(DEFAULT_TRANSCRIPTION_TIMEOUT_MS).toBe(300_000);
  });
});
