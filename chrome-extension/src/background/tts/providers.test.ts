import { getProvider, PROVIDERS } from './providers';
import { describe, it, expect, vi } from 'vitest';

// Mock the kokoro-bridge to avoid chrome.runtime dependency
vi.mock('./providers/kokoro-bridge', () => ({
  requestSynthesis: vi.fn(),
}));

describe('tts/providers registry', () => {
  it('getProvider("kokoro") returns the kokoro provider', () => {
    const provider = getProvider('kokoro');
    expect(provider).toBeDefined();
    expect(provider!.id).toBe('kokoro');
  });

  it('getProvider("openai") returns the openai provider', () => {
    const provider = getProvider('openai');
    expect(provider).toBeDefined();
    expect(provider!.id).toBe('openai');
  });

  it('getProvider returns undefined for unknown id', () => {
    expect(getProvider('unknown')).toBeUndefined();
    expect(getProvider('')).toBeUndefined();
  });

  it('PROVIDERS array contains kokoro and openai', () => {
    expect(PROVIDERS).toHaveLength(2);
    const ids = PROVIDERS.map(p => p.id);
    expect(ids).toContain('kokoro');
    expect(ids).toContain('openai');
  });

  it('each provider has synthesize function', () => {
    for (const p of PROVIDERS) {
      expect(typeof p.synthesize).toBe('function');
    }
  });
});
