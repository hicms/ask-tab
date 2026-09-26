import { getProvider, PROVIDERS } from './providers';
import { describe, it, expect } from 'vitest';

describe('tts/providers registry', () => {
  it('getProvider("openai") returns the openai provider', () => {
    const provider = getProvider('openai');
    expect(provider).toBeDefined();
    expect(provider!.id).toBe('openai');
  });

  it('getProvider returns undefined for unknown id', () => {
    expect(getProvider('unknown')).toBeUndefined();
    expect(getProvider('')).toBeUndefined();
  });

  it('PROVIDERS array contains only openai', () => {
    expect(PROVIDERS.map(p => p.id)).toEqual(['openai']);
  });

  it('each provider has synthesize function', () => {
    for (const p of PROVIDERS) {
      expect(typeof p.synthesize).toBe('function');
    }
  });
});
